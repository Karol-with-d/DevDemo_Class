"""Time-normalized, debounced pose and face analysis for live teaching sessions.

Designed to run off the asyncio event loop (via asyncio.to_thread) so MediaPipe
inference never stalls live transcription or HTTP requests.
"""

from __future__ import annotations

from collections import deque
import math
import threading
import time

_DETECTOR_LOCK = threading.Lock()
_MAX_INFERENCE_WIDTH = 640

MENSAJE_GIRO = {
    "espaldas": ("¡Atención! De espaldas a la cámara", "Sin contacto visual (De espaldas)"),
    "perfil": ("De perfil: no mira a la cámara", "Sin contacto visual (De perfil)"),
    "abajo": ("Cabeza baja o fuera de cuadro", "Sin contacto visual (Cabeza baja)"),
}

# Orientation / head-pose thresholds
YAW_PROFILE_DEG = 28.0
PITCH_DOWN_DEG = 24.0
TURN_WARN_SECONDS = 0.25
TURN_ALERT_SECONDS = 0.90
TURN_CLEAR_SECONDS = 0.50

# Mobility thresholds (normalized to shoulder-widths per second — FPS independent)
MOBILITY_WINDOW_SECONDS = 10.0
MOBILITY_MIN_SECONDS = 3.0
MOBILITY_TAU_SECONDS = 0.20
MOBILITY_SPEED_THRESHOLD = 0.20  # shoulder-widths / sec
MOBILITY_JUMP_THRESHOLD = 0.65   # single-step teleport filter (shoulder-widths)

# Wrist gesture thresholds (actual hand motion, not static wrist height)
GESTURE_WINDOW_SECONDS = 6.0
GESTURE_SPEED_THRESHOLD = 0.35   # shoulder-widths / sec
GESTURE_JUMP_THRESHOLD = 1.20    # single-step teleport filter (shoulder-widths)
GESTURE_OUT_OF_FRAME_SECONDS = 3.0
GESTURE_ACTIVE_RATIO = 0.18
GESTURE_RECENT_HOLD_SECONDS = 1.5

# Eye-contact & blink debouncing (seconds)
BLINK_DEBOUNCE_SECONDS = 0.70    # normal blinks are 0.1–0.4s
GAZE_AWAY_DEBOUNCE_SECONDS = 1.20  # brief glances at slides/notes are < 1.2s
EYE_RECOVER_SECONDS = 0.25
BLENDSHAPE_TAU_SECONDS = 0.15

# Expression & incident tracking
SMILE_TAU_SECONDS = 0.60
SMILE_ENTER_THRESHOLD = 0.28
SMILE_EXIT_THRESHOLD = 0.18
INCIDENT_MIN_SECONDS = 2.0
MAX_RECORDED_INCIDENTS = 12

INCIDENT_LABELS = {
    "espaldas": "De espaldas a la cámara",
    "perfil": "De perfil (sin mirar a la cámara)",
    "abajo": "Cabeza baja o fuera de cuadro",
    "mirada_desviada": "Mirada desviada prolongada",
    "ojos_cerrados": "Ojos cerrados prolongados",
}


def _ema(current: float | None, value: float, dt: float, tau: float) -> float:
    if current is None:
        return value
    alpha = 1.0 - math.exp(-dt / max(tau, 1e-3))
    return current + alpha * (value - current)


def head_angles_from_matrix(matrix) -> tuple[float, float] | None:
    """Return (yaw_deg, pitch_down_deg) from MediaPipe's 4x4 facial transform matrix.

    In MediaPipe's OpenGL canonical camera frame (+Y up, +Z toward camera):
    - yaw_deg: positive/negative left-right head turn; 0 = facing camera
    - pitch_down_deg: positive when chin drops / face tilts DOWN; negative when tilted UP
    """
    if matrix is None:
        return None
    try:
        m02 = float(matrix[0][2])
        m12 = float(matrix[1][2])
        m22 = float(matrix[2][2])
    except (IndexError, TypeError, ValueError):
        return None
    yaw_deg = math.degrees(math.atan2(m02, m22))
    pitch_down_deg = math.degrees(math.atan2(-m12, math.hypot(m02, m22)))
    return yaw_deg, pitch_down_deg


def head_turn_from_face(landmarks, matrix=None) -> tuple[str | None, float | None, float | None]:
    """Detect profile or head-down turn using 3D head pose (immune to camera framing)."""
    angles = head_angles_from_matrix(matrix)
    if angles is not None:
        yaw_deg, pitch_down_deg = angles
        if abs(yaw_deg) >= YAW_PROFILE_DEG:
            return "perfil", yaw_deg, pitch_down_deg
        if pitch_down_deg >= PITCH_DOWN_DEG:
            return "abajo", yaw_deg, pitch_down_deg
        return None, yaw_deg, pitch_down_deg

    # Fallback only when the transformation matrix is unavailable
    if not landmarks or len(landmarks) < 455:
        return None, None, None
    nose = landmarks[1]
    forehead = landmarks[10]
    left_eye, right_eye = landmarks[33], landmarks[263]
    left_cheek, right_cheek = landmarks[234], landmarks[454]
    chin = landmarks[152]

    width = max(abs(right_cheek.x - left_cheek.x), 1e-4)
    yaw_asym = abs(nose.x - (left_cheek.x + right_cheek.x) / 2.0) / width
    depth = abs(left_cheek.z - right_cheek.z)
    if yaw_asym >= 0.30 or depth >= 0.08 or (yaw_asym >= 0.20 and depth >= 0.045):
        return "perfil", None, None

    eye_span = max(abs(right_eye.x - left_eye.x), 1e-4)
    pitch_ratio = (nose.y - (left_eye.y + right_eye.y) / 2.0) / eye_span
    z_tilt = chin.z - forehead.z
    # Require both 3D z-tilt and vertical ratio so low framing never triggers "abajo".
    if pitch_ratio >= 1.85 and z_tilt >= 0.085:
        return "abajo", None, None
    return None, None, None


def head_turn_from_pose(landmarks) -> str | None:
    """Backup when FaceLandmarker drops: strong profile ears or head genuinely tilted/out."""
    if not landmarks or len(landmarks) < 9:
        return None
    nose = landmarks[0]
    left_eye, right_eye = landmarks[2], landmarks[5]
    left_ear, right_ear = landmarks[7], landmarks[8]

    if left_ear.visibility > 0.45 and right_ear.visibility > 0.45 and nose.visibility > 0.35:
        span = max(abs(left_ear.x - right_ear.x), 1e-4)
        asym = abs(abs(nose.x - left_ear.x) - abs(nose.x - right_ear.x)) / span
        if asym >= 0.85:
            return "perfil"

    if left_eye.visibility > 0.35 and right_eye.visibility > 0.35 and nose.visibility > 0.35:
        span = max(abs(left_eye.x - right_eye.x), 0.015)
        pitch = (nose.y - (left_eye.y + right_eye.y) / 2.0) / span
        if pitch >= 2.4:
            return "abajo"

    # Only flag framing-based "abajo" if the nose is practically off the bottom edge.
    if nose.visibility > 0.35 and nose.y >= 0.93:
        return "abajo"
    return None


def run_mediapipe_detection(
    jpeg_bytes: bytes,
    *,
    cv2_mod,
    np_mod,
    mp_mod,
    pose_landmarker,
    face_landmarker,
):
    """Decode JPEG and run Pose + Face MediaPipe detectors safely off the event loop."""
    np_arr = np_mod.frombuffer(jpeg_bytes, np_mod.uint8)
    frame = cv2_mod.imdecode(np_arr, cv2_mod.IMREAD_COLOR)
    if frame is None:
        return None

    h, w, _ = frame.shape
    if w > _MAX_INFERENCE_WIDTH:
        scale = _MAX_INFERENCE_WIDTH / float(w)
        frame = cv2_mod.resize(
            frame,
            (_MAX_INFERENCE_WIDTH, max(1, int(round(h * scale)))),
            interpolation=cv2_mod.INTER_AREA,
        )
        h, w, _ = frame.shape

    frame_rgb = cv2_mod.cvtColor(frame, cv2_mod.COLOR_BGR2RGB)
    mp_image = mp_mod.Image(image_format=mp_mod.ImageFormat.SRGB, data=frame_rgb)

    with _DETECTOR_LOCK:
        pose_result = pose_landmarker.detect(mp_image) if pose_landmarker else None
        face_result = face_landmarker.detect(mp_image) if face_landmarker else None

    return (w, h, pose_result, face_result)


class PoseSessionAnalyzer:
    """Stateful, time-normalized analyzer for one live camera WebSocket connection."""

    def __init__(self):
        self._last_ts: float | None = None

        # Mirror-safe frontal shoulder sign calibration (+1 unmirrored, -1 mirrored)
        self._frontal_sign_votes = 0
        self._frontal_shoulder_sign: int | None = None

        # Orientation / back-turned debouncing
        self._turn_elapsed = 0.0
        self._front_elapsed = 0.0
        self._espalda_activa = False
        self._motivo_sostenido: str | None = None

        # Time-normalized mobility tracking
        self._prev_center: tuple[float, float] | None = None
        self._smooth_center: tuple[float, float] | None = None
        self._mobility_samples: deque[tuple[float, float, bool]] = deque()
        self._seconds_without_pose = 0.0

        # Motion-based wrist gesture tracking
        self._prev_wrists: dict[str, tuple[float, float] | None] = {"left": None, "right": None}
        self._gesture_samples: deque[tuple[float, float, bool, bool]] = deque()
        self._last_gesture_ts: float | None = None
        self._seconds_wrists_hidden = 0.0

        # Eye contact & blink debouncing
        self._smooth_bs: dict[str, float] = {}
        self._closed_elapsed = 0.0
        self._away_elapsed = 0.0
        self._direct_elapsed = 0.0
        self._eye_state: str = "direct"  # "direct" | "closed" | "away"

        # Expression EMA + hysteresis
        self._smooth_smile: float | None = None
        self._smiling = False

        # Session-wide time-weighted accumulators for post-session summary
        self._session_start_ts: float | None = None
        self._frames_analyzed = 0
        self._duration_analyzed_sec = 0.0
        self._person_detected_sec = 0.0

        self._orient_sec = {"front": 0.0, "profile": 0.0, "back": 0.0, "down": 0.0}
        self._eye_sec = {"direct": 0.0, "away": 0.0, "closed": 0.0, "turn": 0.0}
        self._expr_sec = {"cordial": 0.0, "neutral": 0.0}

        self._mobility_tracked_sec = 0.0
        self._mobility_moving_sec = 0.0
        self._last_mobility_moving: bool | None = None

        self._gesture_pose_sec = 0.0
        self._gesture_visible_sec = 0.0
        self._gesture_moving_sec = 0.0
        self._last_gesture_visible = False
        self._last_gesture_moving = False

        # Sustained incident tracker (kind -> start offset sec)
        self._active_incident_kind: str | None = None
        self._active_incident_start: float = 0.0
        self._last_offset_sec: float = 0.0
        self._incidents: list[dict] = []

    def _compute_dt(self, now: float) -> float:
        if self._last_ts is None:
            self._last_ts = now
            return 0.1
        dt = now - self._last_ts
        self._last_ts = now
        return max(0.02, min(dt, 1.0))

    def _prune_window(self, samples: deque, now: float, window: float) -> None:
        cutoff = now - window
        while samples and samples[0][0] < cutoff:
            samples.popleft()

    def _update_frontal_shoulder_sign(self, shoulder_diff: float, yaw_deg: float | None) -> None:
        """Learn camera mirroring from confirmed frontal face frames."""
        if yaw_deg is None or abs(yaw_deg) > 20.0 or abs(shoulder_diff) < 0.06:
            return
        observed = 1 if shoulder_diff > 0 else -1
        if self._frontal_shoulder_sign is None:
            self._frontal_sign_votes += observed
            if abs(self._frontal_sign_votes) >= 3:
                self._frontal_shoulder_sign = 1 if self._frontal_sign_votes > 0 else -1

    def _update_mobility(self, now: float, dt: float, landmarks, w: int, h: int) -> tuple[str, str]:
        shoulder_left, shoulder_right = landmarks[11], landmarks[12]
        hombros_confiables = shoulder_left.visibility > 0.5 and shoulder_right.visibility > 0.5
        ancho_hombros = max(
            math.hypot(
                (shoulder_left.x - shoulder_right.x) * w,
                (shoulder_left.y - shoulder_right.y) * h,
            ),
            1.0,
        )
        center_x = ((shoulder_left.x + shoulder_right.x) / 2.0) * w
        center_y = ((shoulder_left.y + shoulder_right.y) / 2.0) * h

        if hombros_confiables:
            if self._smooth_center is None or self._prev_center is None:
                self._smooth_center = (center_x, center_y)
                self._prev_center = (center_x, center_y)
                self._last_mobility_moving = None
            else:
                sx = _ema(self._smooth_center[0], center_x, dt, MOBILITY_TAU_SECONDS)
                sy = _ema(self._smooth_center[1], center_y, dt, MOBILITY_TAU_SECONDS)
                step_rel = math.hypot(sx - self._prev_center[0], sy - self._prev_center[1]) / ancho_hombros

                if step_rel >= MOBILITY_JUMP_THRESHOLD:
                    self._smooth_center = (center_x, center_y)
                    self._prev_center = (center_x, center_y)
                    self._last_mobility_moving = None
                else:
                    self._smooth_center = (sx, sy)
                    self._prev_center = (sx, sy)
                    speed = step_rel / dt  # shoulder-widths per second
                    is_moving = speed >= MOBILITY_SPEED_THRESHOLD
                    self._last_mobility_moving = is_moving
                    self._mobility_tracked_sec += dt
                    if is_moving:
                        self._mobility_moving_sec += dt
                    self._mobility_samples.append((now, dt, is_moving))
        else:
            self._last_mobility_moving = None

        self._prune_window(self._mobility_samples, now, MOBILITY_WINDOW_SECONDS)
        total_dt = sum(item[1] for item in self._mobility_samples)
        if total_dt < MOBILITY_MIN_SECONDS:
            return "Analizando movilidad...", "#9ca3af"

        moving_dt = sum(item[1] for item in self._mobility_samples if item[2])
        ratio = moving_dt / total_dt
        if ratio > 0.35:
            return "Excelente dinamismo corporal", "#22c55e"
        if ratio > 0.12:
            return "Movilidad moderada", "#eab308"
        return "Docente muy estático", "#ef4444"

    def _update_gestures(self, now: float, dt: float, landmarks, w: int, h: int) -> str:
        shoulder_left, shoulder_right = landmarks[11], landmarks[12]
        ancho_hombros = max(
            math.hypot(
                (shoulder_left.x - shoulder_right.x) * w,
                (shoulder_left.y - shoulder_right.y) * h,
            ),
            1.0,
        )

        wrists = {"left": landmarks[15], "right": landmarks[16]}
        any_visible = False
        any_moving = False

        for side, wrist in wrists.items():
            visible = (
                wrist.visibility > 0.45
                and -0.05 <= wrist.x <= 1.05
                and -0.05 <= wrist.y <= 1.05
            )
            if not visible:
                self._prev_wrists[side] = None
                continue

            any_visible = True
            pos = (wrist.x * w, wrist.y * h)
            prev = self._prev_wrists[side]
            self._prev_wrists[side] = pos
            if prev is not None:
                step_rel = math.hypot(pos[0] - prev[0], pos[1] - prev[1]) / ancho_hombros
                if step_rel < GESTURE_JUMP_THRESHOLD and (step_rel / dt) >= GESTURE_SPEED_THRESHOLD:
                    any_moving = True

        if any_visible:
            self._seconds_wrists_hidden = 0.0
        else:
            self._seconds_wrists_hidden += dt

        if any_moving:
            self._last_gesture_ts = now

        self._last_gesture_visible = any_visible
        self._last_gesture_moving = any_moving
        self._gesture_pose_sec += dt
        if any_visible:
            self._gesture_visible_sec += dt
        if any_moving:
            self._gesture_moving_sec += dt

        self._gesture_samples.append((now, dt, any_visible, any_moving))
        self._prune_window(self._gesture_samples, now, GESTURE_WINDOW_SECONDS)

        total_dt = sum(item[1] for item in self._gesture_samples)
        visible_dt = sum(item[1] for item in self._gesture_samples if item[2])
        moving_dt = sum(item[1] for item in self._gesture_samples if item[3])

        if self._last_gesture_ts is not None and (now - self._last_gesture_ts) <= GESTURE_RECENT_HOLD_SECONDS:
            return "Buen uso de gesticulación"
        if visible_dt >= 0.6 and (moving_dt / visible_dt) >= GESTURE_ACTIVE_RATIO:
            return "Buen uso de gesticulación"
        if (not any_visible and self._seconds_wrists_hidden >= GESTURE_OUT_OF_FRAME_SECONDS) or (
            total_dt >= GESTURE_OUT_OF_FRAME_SECONDS and visible_dt < 0.6
        ):
            return "Manos fuera de cuadro"
        if total_dt < 1.5 and self._last_gesture_ts is None:
            return "Analizando gesticulación..."
        return "Gestos limitados (Manos estáticas)"

    def _update_eye_contact(self, dt: float, blendshapes: dict[str, float]) -> tuple[str, str]:
        keys = (
            "eyeBlinkLeft",
            "eyeBlinkRight",
            "eyeLookOutLeft",
            "eyeLookInRight",
            "eyeLookOutRight",
            "eyeLookInLeft",
            "eyeLookUpLeft",
            "eyeLookUpRight",
            "eyeLookDownLeft",
            "eyeLookDownRight",
        )
        for key in keys:
            self._smooth_bs[key] = _ema(
                self._smooth_bs.get(key),
                blendshapes.get(key, 0.0),
                dt,
                BLENDSHAPE_TAU_SECONDS,
            )

        bs = self._smooth_bs
        raw_closed = bs["eyeBlinkLeft"] > 0.65 and bs["eyeBlinkRight"] > 0.65
        mira_izq = bs["eyeLookOutLeft"] > 0.55 and bs["eyeLookInRight"] > 0.55
        mira_der = bs["eyeLookOutRight"] > 0.55 and bs["eyeLookInLeft"] > 0.55
        mira_arriba = bs["eyeLookUpLeft"] > 0.65 and bs["eyeLookUpRight"] > 0.65
        mira_abajo = bs["eyeLookDownLeft"] > 0.75 and bs["eyeLookDownRight"] > 0.75
        raw_away = (not raw_closed) and (mira_izq or mira_der or mira_arriba or mira_abajo)

        if raw_closed:
            self._closed_elapsed += dt
            self._away_elapsed = 0.0
            self._direct_elapsed = 0.0
            if self._closed_elapsed >= BLINK_DEBOUNCE_SECONDS:
                self._eye_state = "closed"
        elif raw_away:
            self._away_elapsed += dt
            self._closed_elapsed = 0.0
            self._direct_elapsed = 0.0
            if self._away_elapsed >= GAZE_AWAY_DEBOUNCE_SECONDS:
                self._eye_state = "away"
        else:
            self._closed_elapsed = 0.0
            self._away_elapsed = 0.0
            self._direct_elapsed += dt
            if self._direct_elapsed >= EYE_RECOVER_SECONDS:
                self._eye_state = "direct"

        if self._eye_state == "closed":
            return "Ojos cerrados", "#eab308"
        if self._eye_state == "away":
            return "Mirada desviada", "#eab308"
        return "Contacto visual directo", "#22c55e"

    def _update_expression(self, dt: float, blendshapes: dict[str, float]) -> str:
        raw_smile = (blendshapes.get("mouthSmileLeft", 0.0) + blendshapes.get("mouthSmileRight", 0.0)) / 2.0
        self._smooth_smile = _ema(self._smooth_smile, raw_smile, dt, SMILE_TAU_SECONDS)
        if not self._smiling and self._smooth_smile >= SMILE_ENTER_THRESHOLD:
            self._smiling = True
        elif self._smiling and self._smooth_smile <= SMILE_EXIT_THRESHOLD:
            self._smiling = False
        return "Expresión cordial / Sonrisa" if self._smiling else "Expresión atenta / Neutral"

    def _close_incident(self, end_sec: float) -> None:
        if self._active_incident_kind is None:
            return
        duration = end_sec - self._active_incident_start
        if duration >= INCIDENT_MIN_SECONDS and len(self._incidents) < MAX_RECORDED_INCIDENTS:
            kind = self._active_incident_kind
            self._incidents.append({
                "type": kind,
                "label": INCIDENT_LABELS.get(kind, kind),
                "startSec": round(max(0.0, self._active_incident_start), 1),
                "endSec": round(max(self._active_incident_start, end_sec), 1),
                "durationSec": round(duration, 1),
            })
        self._active_incident_kind = None

    def _update_incident(self, offset_sec: float, incident_kind: str | None) -> None:
        if incident_kind == self._active_incident_kind:
            return
        self._close_incident(offset_sec)
        if incident_kind is not None:
            self._active_incident_kind = incident_kind
            self._active_incident_start = offset_sec

    def _record_session_sample(
        self,
        *,
        ts: float,
        dt: float,
        pose_detected: bool,
        face_detected: bool,
        motivo_visible: str | None,
        alerta_contacto: str,
        alerta_expresion: str,
    ) -> None:
        if self._session_start_ts is None:
            self._session_start_ts = ts
        offset_sec = max(0.0, ts - self._session_start_ts)
        self._last_offset_sec = offset_sec
        self._frames_analyzed += 1
        self._duration_analyzed_sec += dt

        if not (pose_detected or face_detected):
            self._update_incident(offset_sec, None)
            return

        self._person_detected_sec += dt

        if motivo_visible == "espaldas":
            self._orient_sec["back"] += dt
        elif motivo_visible == "perfil":
            self._orient_sec["profile"] += dt
        elif motivo_visible == "abajo":
            self._orient_sec["down"] += dt
        else:
            self._orient_sec["front"] += dt

        if motivo_visible in ("espaldas", "perfil", "abajo"):
            self._eye_sec["turn"] += dt
        elif alerta_contacto == "Ojos cerrados":
            self._eye_sec["closed"] += dt
        elif alerta_contacto in ("Mirada desviada", "Mirada lateral / Giro de cabeza"):
            self._eye_sec["away"] += dt
        elif alerta_contacto == "Contacto visual directo":
            self._eye_sec["direct"] += dt

        if alerta_expresion == "Expresión cordial / Sonrisa":
            self._expr_sec["cordial"] += dt
        elif alerta_expresion in ("Expresión atenta / Neutral", "Expresión atenta"):
            self._expr_sec["neutral"] += dt

        incident_kind: str | None = None
        if self._espalda_activa and motivo_visible in ("espaldas", "perfil", "abajo"):
            incident_kind = motivo_visible
        elif alerta_contacto == "Ojos cerrados":
            incident_kind = "ojos_cerrados"
        elif alerta_contacto == "Mirada desviada":
            incident_kind = "mirada_desviada"
        self._update_incident(offset_sec, incident_kind)

    def summary(self) -> dict | None:
        """Return aggregated, time-weighted session video metrics for storage & rubric."""
        if self._frames_analyzed < 3 or self._duration_analyzed_sec < 1.0:
            return None

        # Snapshot any currently ongoing incident without mutating live tracking state.
        incidents = list(self._incidents)
        if self._active_incident_kind is not None and len(incidents) < MAX_RECORDED_INCIDENTS:
            duration = self._last_offset_sec - self._active_incident_start
            if duration >= INCIDENT_MIN_SECONDS:
                kind = self._active_incident_kind
                incidents.append({
                    "type": kind,
                    "label": INCIDENT_LABELS.get(kind, kind),
                    "startSec": round(max(0.0, self._active_incident_start), 1),
                    "endSec": round(max(self._active_incident_start, self._last_offset_sec), 1),
                    "durationSec": round(duration, 1),
                })

        def pct(part: float, whole: float) -> float:
            if whole <= 0:
                return 0.0
            return round(max(0.0, min(100.0, (part / whole) * 100.0)), 1)

        orient_total = sum(self._orient_sec.values())
        eye_total = sum(self._eye_sec.values())
        expr_total = sum(self._expr_sec.values())

        mobility_pct = pct(self._mobility_moving_sec, self._mobility_tracked_sec)
        if self._mobility_tracked_sec < MOBILITY_MIN_SECONDS:
            mobility_level = "Datos insuficientes"
        elif mobility_pct > 35.0:
            mobility_level = "Excelente dinamismo corporal"
        elif mobility_pct > 12.0:
            mobility_level = "Movilidad moderada"
        else:
            mobility_level = "Docente muy estático"

        wrists_visible_pct = pct(self._gesture_visible_sec, self._gesture_pose_sec)
        hands_mostly_out = self._gesture_pose_sec >= GESTURE_OUT_OF_FRAME_SECONDS and wrists_visible_pct < 20.0
        gesture_active_pct = pct(self._gesture_moving_sec, self._gesture_visible_sec)
        if hands_mostly_out:
            gesture_level = "Manos fuera de cuadro"
        elif self._gesture_visible_sec < 1.0:
            gesture_level = "Datos insuficientes"
        elif gesture_active_pct >= GESTURE_ACTIVE_RATIO * 100.0:
            gesture_level = "Buen uso de gesticulación"
        else:
            gesture_level = "Gestos limitados (Manos estáticas)"

        return {
            "framesAnalyzed": self._frames_analyzed,
            "durationAnalyzedSec": round(self._duration_analyzed_sec, 1),
            "personDetectedPct": pct(self._person_detected_sec, self._duration_analyzed_sec),
            "orientation": {
                "facingCameraPct": pct(self._orient_sec["front"], orient_total),
                "profilePct": pct(self._orient_sec["profile"], orient_total),
                "backTurnedPct": pct(self._orient_sec["back"], orient_total),
                "headDownPct": pct(self._orient_sec["down"], orient_total),
            },
            "eyeContact": {
                "directPct": pct(self._eye_sec["direct"], eye_total),
                "gazeAwayPct": pct(self._eye_sec["away"], eye_total),
                "eyesClosedPct": pct(self._eye_sec["closed"], eye_total),
                "lostDueToTurnPct": pct(self._eye_sec["turn"], eye_total),
            },
            "expression": {
                "cordialPct": pct(self._expr_sec["cordial"], expr_total),
                "neutralPct": pct(self._expr_sec["neutral"], expr_total),
            },
            "mobility": {
                "activePct": mobility_pct,
                "level": mobility_level,
            },
            "gestures": {
                "visiblePct": wrists_visible_pct,
                "activeWhenVisiblePct": gesture_active_pct,
                "handsMostlyOutOfFrame": hands_mostly_out,
                "level": gesture_level,
            },
            "incidents": incidents,
        }

    def analyze(self, pose_result, face_result, w: int, h: int, now: float | None = None) -> dict:
        ts = time.perf_counter() if now is None else float(now)
        dt = self._compute_dt(ts)

        alerta_movilidad = "Analizando..."
        alerta_gestos = "Buscando docente..."
        color_alerta = "#9ca3af"

        alerta_orientacion = "Buscando docente..."
        color_orientacion = "#9ca3af"
        es_de_espaldas = False
        alerta_expresion = "Buscando rostro..."
        alerta_contacto = "Buscando rostro..."
        color_contacto = "#9ca3af"

        pose_detected = bool(pose_result and pose_result.pose_landmarks and len(pose_result.pose_landmarks) > 0)
        face_detected = bool(face_result and face_result.face_landmarks and len(face_result.face_landmarks) > 0)

        matriz_rostro = None
        if face_detected and getattr(face_result, "facial_transformation_matrixes", None):
            matriz_rostro = face_result.facial_transformation_matrixes[0]
        giro_rostro, yaw_deg, _pitch_down_deg = (
            head_turn_from_face(face_result.face_landmarks[0], matriz_rostro)
            if face_detected
            else (None, None, None)
        )

        frame_de_espaldas = False
        landmarks = None
        if pose_detected:
            landmarks = pose_result.pose_landmarks[0]
            self._seconds_without_pose = 0.0

            nose = landmarks[0]
            left_ear, right_ear = landmarks[7], landmarks[8]
            shoulder_left, shoulder_right = landmarks[11], landmarks[12]

            shoulders_visible = shoulder_left.visibility > 0.45 and shoulder_right.visibility > 0.45
            shoulder_diff = shoulder_left.x - shoulder_right.x
            if face_detected and shoulders_visible:
                self._update_frontal_shoulder_sign(shoulder_diff, yaw_deg)

            expected_sign = self._frontal_shoulder_sign if self._frontal_shoulder_sign is not None else 1
            shoulders_inverted = shoulders_visible and (shoulder_diff * expected_sign) < -0.04
            nose_behind_ears = (
                (nose.z > max(left_ear.z, right_ear.z) + 0.03)
                or (nose.visibility < 0.25)
            )
            face_facing_front = face_detected and giro_rostro is None

            if (not face_facing_front) and shoulders_inverted:
                frame_de_espaldas = True
            elif (not face_detected) and nose_behind_ears and shoulders_visible:
                frame_de_espaldas = True

            alerta_gestos = self._update_gestures(ts, dt, landmarks, w, h)
            alerta_movilidad, color_alerta = self._update_mobility(ts, dt, landmarks, w, h)
        else:
            self._seconds_without_pose += dt
            if self._seconds_without_pose > 1.2:
                self._prev_center = None
                self._smooth_center = None
                self._mobility_samples.clear()
                self._prev_wrists = {"left": None, "right": None}
                self._gesture_samples.clear()
                if not face_detected:
                    self._turn_elapsed = 0.0
                    self._front_elapsed = 0.0
                    self._espalda_activa = False
                    self._motivo_sostenido = None

        # Only use pose-only head-turn fallback when face mesh is absent.
        giro_pose = head_turn_from_pose(landmarks) if (pose_detected and not face_detected) else None
        if frame_de_espaldas:
            motivo_frame = "espaldas"
        elif giro_rostro:
            motivo_frame = giro_rostro
        elif giro_pose:
            motivo_frame = giro_pose
        else:
            motivo_frame = None

        if pose_detected or face_detected:
            if motivo_frame:
                self._turn_elapsed += dt
                self._front_elapsed = 0.0
                self._motivo_sostenido = motivo_frame
                if self._turn_elapsed >= TURN_ALERT_SECONDS:
                    self._espalda_activa = True
            else:
                self._front_elapsed += dt
                if self._front_elapsed >= TURN_CLEAR_SECONDS:
                    self._espalda_activa = False
                    self._turn_elapsed = 0.0
                    self._motivo_sostenido = None

        motivo_visible = (
            self._motivo_sostenido
            if (self._espalda_activa or (motivo_frame and self._turn_elapsed >= TURN_WARN_SECONDS))
            else None
        )

        if self._espalda_activa and motivo_visible:
            es_de_espaldas = True
            alerta_orientacion = MENSAJE_GIRO[motivo_visible][0]
            color_orientacion = "#ef4444"
        elif motivo_visible == "perfil":
            alerta_orientacion = "De perfil (Giro parcial)"
            color_orientacion = "#eab308"
        elif motivo_visible == "abajo":
            alerta_orientacion = "Cabeza baja o fuera de cuadro"
            color_orientacion = "#eab308"
        elif motivo_visible == "espaldas":
            alerta_orientacion = "Girando de espaldas..."
            color_orientacion = "#eab308"
        elif face_detected or pose_detected:
            alerta_orientacion = "Frente a la audiencia"
            color_orientacion = "#22c55e"

        if motivo_visible:
            alerta_contacto = MENSAJE_GIRO[motivo_visible][1]
            color_contacto = "#ef4444" if self._espalda_activa else "#eab308"
            if motivo_visible == "espaldas":
                alerta_expresion = "No visible (De espaldas)"

        if (
            motivo_visible != "espaldas"
            and face_detected
            and face_result.face_blendshapes
            and len(face_result.face_blendshapes) > 0
        ):
            blendshapes = {b.category_name: b.score for b in face_result.face_blendshapes[0]}
            alerta_expresion = self._update_expression(dt, blendshapes)
            if not motivo_visible:
                alerta_contacto, color_contacto = self._update_eye_contact(dt, blendshapes)
        elif motivo_visible:
            pass
        elif pose_detected:
            eye_left, eye_right = landmarks[2], landmarks[5]
            nose = landmarks[0]
            ojos_visibles = (
                eye_left.visibility > 0.35
                and eye_right.visibility > 0.35
                and nose.visibility > 0.35
            )
            if ojos_visibles:
                mid_eye_x = (eye_left.x + eye_right.x) / 2.0
                ancho_ojos = max(abs(eye_left.x - eye_right.x), 0.005)
                desviacion_nariz = abs(nose.x - mid_eye_x) / ancho_ojos
                if desviacion_nariz < 0.35:
                    alerta_contacto = "Contacto visual directo"
                    color_contacto = "#22c55e"
                else:
                    alerta_contacto = "Mirada lateral / Giro de cabeza"
                    color_contacto = "#eab308"
                alerta_expresion = "Expresión atenta"
            else:
                alerta_contacto = "Rostro parcialmente cubierto"
                color_contacto = "#eab308"
                alerta_expresion = "Expresión no disponible"
        else:
            alerta_contacto = "Sin contacto visual"
            color_contacto = "#9ca3af"
            alerta_expresion = "Rostro no detectado"

        self._record_session_sample(
            ts=ts,
            dt=dt,
            pose_detected=pose_detected,
            face_detected=face_detected,
            motivo_visible=motivo_visible,
            alerta_contacto=alerta_contacto,
            alerta_expresion=alerta_expresion,
        )

        return {
            "movilidad": alerta_movilidad,
            "gesticulacion": alerta_gestos,
            "status_color": color_alerta,
            "orientacion": alerta_orientacion,
            "orientacion_color": color_orientacion,
            "de_espaldas": es_de_espaldas,
            "expresion": alerta_expresion,
            "contacto_visual": alerta_contacto,
            "contacto_visual_color": color_contacto,
        }
