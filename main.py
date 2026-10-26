from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python import BaseOptions
import math
import os

app = FastAPI()

# Permitir conexiones Cross-Origin (CORS) para Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar MediaPipe Models
script_dir = os.path.dirname(os.path.abspath(__file__))

# 1. Pose Landmarker
possible_pose_models = ["pose_landmarker_heavy.task", "pose_landmarker_full.task", "pose_landmarker_lite.task"]
pose_model_path = next((os.path.join(script_dir, m) for m in possible_pose_models if os.path.exists(os.path.join(script_dir, m))), None)

pose_options = vision.PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=pose_model_path),
    running_mode=vision.RunningMode.IMAGE
)
pose_landmarker = vision.PoseLandmarker.create_from_options(pose_options)

# 2. Face Landmarker (métricas faciales y orientación)
face_model_path = os.path.join(script_dir, "face_landmarker.task")
face_landmarker = None
if os.path.exists(face_model_path):
    face_options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=face_model_path),
        running_mode=vision.RunningMode.IMAGE,
        min_face_detection_confidence=0.3,
        min_face_presence_confidence=0.3,
        min_tracking_confidence=0.3,
        output_face_blendshapes=True,
        num_faces=1
    )
    face_landmarker = vision.FaceLandmarker.create_from_options(face_options)

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "service": "pose-and-face-analysis",
        "face_model_loaded": face_landmarker is not None
    }

@app.websocket("/ws/pose-analysis")
async def websocket_pose_analysis(websocket: WebSocket):
    await websocket.accept()
    print("[INFO] Cliente conectado via WebSocket")

    prev_center_x, prev_center_y = None, None
    smooth_center_x, smooth_center_y = None, None
    historial_movimiento = []
    historial_espaldas = []
    frames_sin_pose = 0
    VENTANA_FRAMES = 90
    MIN_MUESTRAS_MOVIMIENTO = 30
    # Pose landmarks jitter while the teacher stands still. Movement has to clear
    # that noise, and a one-frame leap is a bad detection, not walking.
    UMBRAL_MOVIMIENTO = 0.10
    UMBRAL_SALTO = 0.65
    SUAVIZADO = 0.35

    try:
        while True:
            # Recibir fotograma binario de la cámara
            bytes_data = await websocket.receive_bytes()
            np_arr = np.frombuffer(bytes_data, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

            if frame is None:
                continue

            h, w, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)

            # Ejecutar inferencia para pose y rostro
            pose_result = pose_landmarker.detect(mp_image)
            face_result = face_landmarker.detect(mp_image) if face_landmarker else None

            # Valores por defecto
            alerta_movilidad = "Analizando..."
            alerta_gestos = "Buscando docente..."
            color_alerta = "#9ca3af"

            alerta_orientacion = "Buscando docente..."
            color_orientacion = "#9ca3af"
            es_de_espaldas = False
            alerta_expresion = "Buscando rostro..."
            alerta_contacto = "Buscando rostro..."
            color_contacto = "#9ca3af"

            pose_detected = pose_result and pose_result.pose_landmarks and len(pose_result.pose_landmarks) > 0
            face_detected = face_result and face_result.face_landmarks and len(face_result.face_landmarks) > 0

            if pose_detected:
                landmarks = pose_result.pose_landmarks[0]

                # Puntos anatómicos principales
                nose = landmarks[0]
                left_ear, right_ear = landmarks[7], landmarks[8]
                shoulder_left, shoulder_right = landmarks[11], landmarks[12]
                wrist_left, wrist_right = landmarks[15], landmarks[16]
                hip_left, hip_right = landmarks[23], landmarks[24]

                # --- 1. DETECCIÓN DE ORIENTACIÓN: DAR LA ESPALDA A LA CÁMARA ---
                shoulders_visible = (shoulder_left.visibility > 0.35 and shoulder_right.visibility > 0.35)
                # En vista frontal: shoulder_left.x > shoulder_right.x
                # De espaldas: shoulder_left.x < shoulder_right.x (inversión de hombros)
                shoulder_diff = shoulder_left.x - shoulder_right.x

                # Comprobación de profundidad relativa de la nariz
                nose_behind_ears = (nose.z > left_ear.z and nose.z > right_ear.z) or (nose.visibility < 0.25)

                frame_de_espaldas = False
                if shoulders_visible and shoulder_diff < -0.04:
                    frame_de_espaldas = True
                elif (not face_detected) and nose_behind_ears and shoulders_visible:
                    frame_de_espaldas = True

                # Suavizado de detección
                historial_espaldas.append(1 if frame_de_espaldas else 0)
                if len(historial_espaldas) > 10:
                    historial_espaldas.pop(0)

                de_espaldas_confirmado = (sum(historial_espaldas) / len(historial_espaldas)) >= 0.4

                if de_espaldas_confirmado:
                    es_de_espaldas = True
                    alerta_orientacion = "¡Atención! De espaldas a la cámara"
                    color_orientacion = "#ef4444" # Rojo
                elif face_detected:
                    es_de_espaldas = False
                    alerta_orientacion = "Frente a la audiencia"
                    color_orientacion = "#22c55e" # Verde
                elif abs(shoulder_diff) < 0.08:
                    es_de_espaldas = False
                    alerta_orientacion = "De perfil (Giro parcial)"
                    color_orientacion = "#eab308" # Amarillo
                else:
                    es_de_espaldas = False
                    alerta_orientacion = "Frente a la audiencia"
                    color_orientacion = "#22c55e" # Verde

                # --- 2. EVALUACIÓN DE GESTOS ---
                altura_cadera = (hip_left.y + hip_right.y) / 2 if (hip_left.visibility > 0.3 and hip_right.visibility > 0.3) else 0.85
                manos_elevadas = (wrist_left.visibility > 0.4 and wrist_left.y < altura_cadera) or \
                                 (wrist_right.visibility > 0.4 and wrist_right.y < altura_cadera)
                alerta_gestos = "Buen uso de gesticulación" if manos_elevadas else "Gestos limitados (Manos bajas)"

                # --- 3. EVALUACIÓN DE MOVILIDAD ---
                frames_sin_pose = 0
                hombros_confiables = shoulder_left.visibility > 0.5 and shoulder_right.visibility > 0.5
                ancho_hombros = max(math.hypot((shoulder_left.x - shoulder_right.x) * w, (shoulder_left.y - shoulder_right.y) * h), 1.0)
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
                        alerta_movilidad = "Excelente dinamismo corporal"
                        color_alerta = "#22c55e" # Verde
                    elif movimiento_promedio > 0.15:
                        alerta_movilidad = "Movilidad moderada"
                        color_alerta = "#eab308" # Amarillo
                    else:
                        alerta_movilidad = "Docente muy estático"
                        color_alerta = "#ef4444" # Rojo
                else:
                    alerta_movilidad = "Analizando movilidad..."
                    color_alerta = "#9ca3af"
            else:
                frames_sin_pose += 1
                if frames_sin_pose > 8:
                    prev_center_x, prev_center_y = None, None
                    smooth_center_x, smooth_center_y = None, None
                    historial_movimiento.clear()

            # --- 4. MÉTRICAS FACIALES Y CONTACTO VISUAL ---
            if es_de_espaldas:
                alerta_contacto = "Sin contacto visual (De espaldas)"
                color_contacto = "#ef4444" # Rojo
                alerta_expresion = "No visible (De espaldas)"
            elif face_detected and face_result.face_blendshapes and len(face_result.face_blendshapes) > 0:
                blendshapes = {b.category_name: b.score for b in face_result.face_blendshapes[0]}

                # Sonrisa y amabilidad
                smile_score = (blendshapes.get("mouthSmileLeft", 0) + blendshapes.get("mouthSmileRight", 0)) / 2.0
                if smile_score > 0.20:
                    alerta_expresion = "Expresión cordial / Sonrisa"
                else:
                    alerta_expresion = "Expresión atenta / Neutral"

                # Parpadeo / Ojos cerrados
                ojos_cerrados = blendshapes.get("eyeBlinkLeft", 0) > 0.65 and blendshapes.get("eyeBlinkRight", 0) > 0.65

                # Mirada lateral coordinada (ambos ojos mirando marcadamente a un lado)
                mira_izq = blendshapes.get("eyeLookOutLeft", 0) > 0.55 and blendshapes.get("eyeLookInRight", 0) > 0.55
                mira_der = blendshapes.get("eyeLookOutRight", 0) > 0.55 and blendshapes.get("eyeLookInLeft", 0) > 0.55
                mira_arriba = blendshapes.get("eyeLookUpLeft", 0) > 0.65 and blendshapes.get("eyeLookUpRight", 0) > 0.65
                mira_abajo = blendshapes.get("eyeLookDownLeft", 0) > 0.75 and blendshapes.get("eyeLookDownRight", 0) > 0.75

                if ojos_cerrados:
                    alerta_contacto = "Ojos cerrados"
                    color_contacto = "#eab308" # Amarillo
                elif mira_izq or mira_der or mira_arriba or mira_abajo:
                    alerta_contacto = "Mirada desviada"
                    color_contacto = "#eab308" # Amarillo
                else:
                    alerta_contacto = "Contacto visual directo"
                    color_contacto = "#22c55e" # Verde
            elif pose_detected:
                # Fallback con Pose Landmarker (cuando FaceLandmarker no detecta por distancia o luz)
                eye_left, eye_right = landmarks[2], landmarks[5]
                nose = landmarks[0]
                ojos_visibles = (eye_left.visibility > 0.35 and eye_right.visibility > 0.35 and nose.visibility > 0.35)

                if ojos_visibles:
                    mid_eye_x = (eye_left.x + eye_right.x) / 2.0
                    ancho_ojos = max(abs(eye_left.x - eye_right.x), 0.005)
                    desviacion_nariz = abs(nose.x - mid_eye_x) / ancho_ojos

                    if desviacion_nariz < 0.35:
                        alerta_contacto = "Contacto visual directo"
                        color_contacto = "#22c55e" # Verde
                    else:
                        alerta_contacto = "Mirada lateral / Giro de cabeza"
                        color_contacto = "#eab308" # Amarillo
                    alerta_expresion = "Expresión atenta"
                else:
                    alerta_contacto = "Rostro parcialmente cubierto"
                    color_contacto = "#eab308"
                    alerta_expresion = "Expresión no disponible"
            else:
                alerta_contacto = "Sin contacto visual"
                color_contacto = "#9ca3af"
                alerta_expresion = "Rostro no detectado"

            # Emitir métricas completas actualizadas a la web
            await websocket.send_json({
                "movilidad": alerta_movilidad,
                "gesticulacion": alerta_gestos,
                "status_color": color_alerta,
                "orientacion": alerta_orientacion,
                "orientacion_color": color_orientacion,
                "de_espaldas": es_de_espaldas,
                "expresion": alerta_expresion,
                "contacto_visual": alerta_contacto,
                "contacto_visual_color": color_contacto
            })

    except WebSocketDisconnect:
        print("[INFO] Cliente desconectado del WebSocket")
    except Exception as e:
        print(f"[ERROR] Error en WebSocket: {e}")

if __name__ == "__main__":
    import uvicorn
    # One process, no reloader. The reloader binds port 8000 twice on Windows and
    # drops the socket whenever Visual Studio or Next.js writes files.
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)