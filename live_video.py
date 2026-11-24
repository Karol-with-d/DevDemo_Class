import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python import BaseOptions
import time
import math
import os

# -------------------------------------------------------------
# 1. LANDMARK CONNECTIONS DEFINITIONS
# -------------------------------------------------------------
POSE_CONNECTIONS = [
    # Face / Head
    (0, 1), (1, 2), (2, 3), (3, 7),
    (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10),
    # Torso
    (11, 12), (11, 23), (12, 24), (23, 24),
    # Left Arm
    (11, 13), (13, 15), (15, 17), (15, 19), (15, 21), (17, 19),
    # Right Arm
    (12, 14), (14, 16), (16, 18), (16, 20), (16, 22), (18, 20),
    # Left Leg
    (23, 25), (25, 27), (27, 29), (27, 31), (29, 31),
    # Right Leg
    (24, 26), (26, 28), (28, 30), (28, 32), (30, 32)
]

HAND_CONNECTIONS = [
    # Thumb
    (0, 1), (1, 2), (2, 3), (3, 4),
    # Index
    (0, 5), (5, 6), (6, 7), (7, 8),
    # Middle
    (9, 10), (10, 11), (11, 12),
    # Ring
    (13, 14), (14, 15), (15, 16),
    # Pinky
    (0, 17), (17, 18), (18, 19), (19, 20),
    # Palm Base
    (5, 9), (9, 13), (13, 17)
]

# -------------------------------------------------------------
# 2. GLOBAL STATE & CALLBACKS
# -------------------------------------------------------------
latest_pose_result = None
latest_hand_result = None

def pose_callback(result, output_image, timestamp_ms):
    global latest_pose_result
    latest_pose_result = result

def hand_callback(result, output_image, timestamp_ms):
    global latest_hand_result
    latest_hand_result = result

# -------------------------------------------------------------
# 3. MODEL INITIALIZATION WITH AUTO-PATH FALLBACK
# -------------------------------------------------------------
script_dir = os.path.dirname(os.path.abspath(__file__))

pose_model_name = "pose_landmarker_heavy.task" if os.path.exists(os.path.join(script_dir, "pose_landmarker_heavy.task")) else "pose_landmarker_lite.task"
pose_model_path = os.path.join(script_dir, pose_model_name)
hand_model_path = os.path.join(script_dir, "hand_landmarker.task")

pose_options = vision.PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=pose_model_path),
    running_mode=vision.RunningMode.LIVE_STREAM,
    result_callback=pose_callback
)

hand_options = vision.HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=hand_model_path),
    running_mode=vision.RunningMode.LIVE_STREAM,
    num_hands=2,
    result_callback=hand_callback
)

pose_landmarker = vision.PoseLandmarker.create_from_options(pose_options)
hand_landmarker = vision.HandLandmarker.create_from_options(hand_options)

# -------------------------------------------------------------
# 4. TRACKING & SENSITIVITY CONTROL VARIABLES
# -------------------------------------------------------------
prev_center_x = None
prev_center_y = None
smooth_center_x = None
smooth_center_y = None
VENTANA_FRAMES = 90
MIN_MUESTRAS_MOVIMIENTO = 30
# Pose landmarks jitter while the teacher stands still. Movement has to clear
# that noise, and a one-frame leap is a bad detection, not walking.
UMBRAL_MOVIMIENTO = 0.10
UMBRAL_SALTO = 0.65
SUAVIZADO = 0.35
historial_movimiento = []
cooldown_lost_frames = 0

estado_movil_estable = "Buscando al docente..."
color_movil_estable = (200, 200, 200)
estado_gestos_estable = "Sin deteccion de manos"

cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    h, w, _ = frame.shape
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

    timestamp_ms = int(time.time() * 1000)
    pose_landmarker.detect_async(mp_image, timestamp_ms)
    hand_landmarker.detect_async(mp_image, timestamp_ms)

    persona_detectada = False

    # -------------------------------------------------------------
    # 5. POSE PROCESSING & SKELETON DRAWING
    # -------------------------------------------------------------
    if latest_pose_result is not None and latest_pose_result.pose_landmarks:
        if len(latest_pose_result.pose_landmarks) > 0:
            landmarks = latest_pose_result.pose_landmarks[0]
            persona_detectada = True
            cooldown_lost_frames = 0

            pose_points = {}
            for idx, lm in enumerate(landmarks):
                if lm.visibility > 0.4:
                    cx, cy = int(lm.x * w), int(lm.y * h)
                    pose_points[idx] = (cx, cy)
                    cv2.circle(frame, (cx, cy), 4, (0, 255, 0), -1)

            for start_idx, end_idx in POSE_CONNECTIONS:
                if start_idx in pose_points and end_idx in pose_points:
                    cv2.line(frame, pose_points[start_idx], pose_points[end_idx], (0, 255, 0), 2)

            # --- GESTURES EVALUATION (Wrists / Hands vs Hips) ---
            wrist_left, wrist_right = landmarks[15], landmarks[16]
            hip_left, hip_right = landmarks[23], landmarks[24]

            altura_cadera = (hip_left.y + hip_right.y) / 2 if (hip_left.visibility > 0.3 and hip_right.visibility > 0.3) else 0.85
            manos_elevadas = (wrist_left.visibility > 0.4 and wrist_left.y < altura_cadera) or \
                             (wrist_right.visibility > 0.4 and wrist_right.y < altura_cadera)

            # Check if hand landmarker is actively tracking detailed hands
            manos_detalladas = (latest_hand_result is not None and 
                                latest_hand_result.hand_landmarks and 
                                len(latest_hand_result.hand_landmarks) > 0)

            if manos_elevadas or manos_detalladas:
                estado_gestos_estable = "Buen uso de gesticulacion"
            else:
                estado_gestos_estable = "Gestos limitados (Manos bajas)"

            # --- NORMALIZED MOVEMENT EVALUATION ---
            shoulder_left, shoulder_right = landmarks[11], landmarks[12]
            hombros_confiables = shoulder_left.visibility > 0.5 and shoulder_right.visibility > 0.5
            ancho_hombros = math.hypot((shoulder_left.x - shoulder_right.x) * w, (shoulder_left.y - shoulder_right.y) * h)
            ancho_hombros = max(ancho_hombros, 1.0)

            center_x = ((shoulder_left.x + shoulder_right.x) / 2) * w
            center_y = ((shoulder_left.y + shoulder_right.y) / 2) * h

            if hombros_confiables:
                if smooth_center_x is None or prev_center_x is None:
                    smooth_center_x, smooth_center_y = center_x, center_y
                    prev_center_x, prev_center_y = center_x, center_y
                else:
                    candidato_x = SUAVIZADO * center_x + (1.0 - SUAVIZADO) * smooth_center_x
                    candidato_y = SUAVIZADO * center_y + (1.0 - SUAVIZADO) * smooth_center_y
                    desplazamiento_relativo = math.hypot(
                        candidato_x - prev_center_x, candidato_y - prev_center_y
                    ) / ancho_hombros

                    if desplazamiento_relativo >= UMBRAL_SALTO:
                        smooth_center_x, smooth_center_y = center_x, center_y
                        prev_center_x, prev_center_y = center_x, center_y
                    else:
                        smooth_center_x, smooth_center_y = candidato_x, candidato_y
                        prev_center_x, prev_center_y = candidato_x, candidato_y
                        historial_movimiento.append(1 if desplazamiento_relativo > UMBRAL_MOVIMIENTO else 0)
                        if len(historial_movimiento) > VENTANA_FRAMES:
                            historial_movimiento.pop(0)

            if len(historial_movimiento) >= MIN_MUESTRAS_MOVIMIENTO:
                movimiento_promedio = sum(historial_movimiento) / len(historial_movimiento)

                if movimiento_promedio > 0.40:
                    estado_movil_estable = "Excelente dinamismo corporal"
                    color_movil_estable = (0, 255, 0)
                elif movimiento_promedio > 0.15:
                    estado_movil_estable = "Movilidad moderada"
                    color_movil_estable = (0, 255, 255)
                else:
                    estado_movil_estable = "Docente muy estatico"
                    color_movil_estable = (0, 0, 255)
            else:
                estado_movil_estable = "Analizando movilidad..."
                color_movil_estable = (200, 200, 200)

    # -------------------------------------------------------------
    # 6. DETAILED HAND PROCESSING & SKELETON DRAWING
    # -------------------------------------------------------------
    if latest_hand_result is not None and latest_hand_result.hand_landmarks:
        for hand_landmarks in latest_hand_result.hand_landmarks:
            hand_points = {}
            for idx, lm in enumerate(hand_landmarks):
                cx, cy = int(lm.x * w), int(lm.y * h)
                hand_points[idx] = (cx, cy)
                cv2.circle(frame, (cx, cy), 3, (0, 255, 255), -1)

            for start_idx, end_idx in HAND_CONNECTIONS:
                if start_idx in hand_points and end_idx in hand_points:
                    cv2.line(frame, hand_points[start_idx], hand_points[end_idx], (255, 255, 0), 2)

    # -------------------------------------------------------------
    # 7. TRACKING LOSS SMOOTHING & UI RENDERING
    # -------------------------------------------------------------
    if not persona_detectada:
        cooldown_lost_frames += 1
        if cooldown_lost_frames > 10:
            estado_movil_estable = "Buscando al docente..."
            color_movil_estable = (200, 200, 200)
            estado_gestos_estable = "Sin deteccion de manos"
            historial_movimiento.clear()
            prev_center_x, prev_center_y = None, None
            smooth_center_x, smooth_center_y = None, None

    # UI Banner
    cv2.rectangle(frame, (10, 10), (500, 90), (0, 0, 0), -1)
    cv2.putText(frame, f"Movilidad: {estado_movil_estable}", (20, 42),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color_movil_estable, 2)
    cv2.putText(frame, f"Gesticulacion: {estado_gestos_estable}", (20, 72),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    cv2.imshow("DevDemo Class - Full Pose & Hand Tracking", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()