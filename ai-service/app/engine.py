import os
import re
import tempfile
from pathlib import Path

import cv2
import httpx
import numpy as np
import pytesseract
import zxingcpp
from PIL import Image
from pytesseract import Output

from .normalization import name_similarity, normalize_date, normalize_fields, normalize_nid, normalize_text, parse_structured_payload
from .security import validate_asset_url

MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).resolve().parents[1] / "models"))
MAX_DOWNLOAD_BYTES = int(os.getenv("IDENTITY_MAX_DOWNLOAD_BYTES", str(22 * 1024 * 1024)))
if os.getenv("TESSERACT_CMD"):
    pytesseract.pytesseract.tesseract_cmd = os.getenv("TESSERACT_CMD")


async def download_asset(client: httpx.AsyncClient, url: str, path: Path) -> None:
    current_url = validate_asset_url(url)
    total = 0
    for _ in range(4):
        async with client.stream(
            "GET",
            current_url,
            follow_redirects=False,
            timeout=90,
            headers={"X-Identity-Service-Key": os.getenv("IDENTITY_AI_SERVICE_KEY", "")},
        ) as response:
            if response.is_redirect:
                location = response.headers.get("location", "")
                current_url = validate_asset_url(str(response.url.join(location)))
                continue
            response.raise_for_status()
            with path.open("wb") as output:
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise ValueError("Asset exceeds processing size limit")
                    output.write(chunk)
            return
    raise ValueError("Asset URL redirected too many times")


def image_quality(image: np.ndarray) -> tuple[bool, list[str]]:
    warnings = []
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if min(image.shape[:2]) < 480:
        warnings.append("Image resolution is low.")
    if float(gray.mean()) < 45:
        warnings.append("Image is too dark.")
    if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < 45:
        warnings.append("Image is blurred.")
    return not warnings, warnings


def ocr_variants(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = max(1.0, 1400 / max(gray.shape))
    resized = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    normalized = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(resized)
    threshold = cv2.adaptiveThreshold(normalized, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11)
    return [resized, normalized, threshold]


DATE_LABEL_PATTERN = r"(?:D[A4]TE\s*(?:OF\s*)?B[I1L]R[T7]H|D[O0]B|জন্ম\s*তারিখ)"
MONTH_PATTERN = r"(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)"
DATE_VALUE_PATTERN = rf"(?:\d{{1,2}}\s+{MONTH_PATTERN}\s+\d{{4}}|{MONTH_PATTERN}\s+\d{{1,2}},?\s+\d{{4}}|\d{{4}}[./-]\d{{1,2}}[./-]\d{{1,2}}|\d{{1,2}}[./-]\d{{1,2}}[./-]\d{{4}})"


def extract_ocr_date(raw_text: str) -> str:
    translated = raw_text.translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789"))
    labelled = re.search(rf"{DATE_LABEL_PATTERN}\s*[:\-]?\s*({DATE_VALUE_PATTERN})", translated, re.I)
    candidate = labelled.group(1) if labelled else ""
    if not candidate:
        fallback = re.search(rf"\b({DATE_VALUE_PATTERN})\b", translated, re.I)
        candidate = fallback.group(1) if fallback else ""
    normalized = normalize_date(candidate)
    return normalized if re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized) else ""


def parse_ocr_fields(raw_text: str) -> dict:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    fields: dict[str, str] = {}
    nid_match = re.search(r"(?:NID|ID\s*NO|জাতীয়\s*পরিচয়\s*পত্র\s*নম্বর)?\D*((?:\d[ -]?){10,17})", raw_text.translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")), re.I)
    if nid_match:
        fields["nidNumber"] = normalize_nid(nid_match.group(1))
    date_of_birth = extract_ocr_date(raw_text)
    if date_of_birth:
        fields["dateOfBirth"] = date_of_birth
    for index, line in enumerate(lines):
        inline_name = re.search(r"(?:\bNAME|নাম)\s*[:\-]?\s*(.+?)\s*$", line, re.I)
        if inline_name:
            fields["name"] = normalize_text(inline_name.group(1))
            break
        if normalize_text(line) in {"NAME", "নাম"} and index + 1 < len(lines):
            fields["name"] = normalize_text(lines[index + 1])
            break
    return normalize_fields(fields)


def extract_ocr(image: np.ndarray) -> dict:
    quality_ok, warnings = image_quality(image)
    best = {"text": "", "confidence": 0.0}
    for variant in ocr_variants(image):
        data = pytesseract.image_to_data(Image.fromarray(variant), lang=os.getenv("TESSERACT_LANG", "ben+eng"), config="--psm 6", output_type=Output.DICT)
        confidences = [float(value) for value in data["conf"] if str(value) != "-1" and float(value) >= 0]
        confidence = sum(confidences) / len(confidences) / 100 if confidences else 0.0
        text = pytesseract.image_to_string(Image.fromarray(variant), lang=os.getenv("TESSERACT_LANG", "ben+eng"), config="--psm 6").strip()
        if confidence > best["confidence"]:
            best = {"text": text, "confidence": confidence}
    fields = parse_ocr_fields(best["text"])
    if not fields.get("name"):
        warnings.append("Full name could not be extracted from the NID front.")
    if not fields.get("nidNumber"):
        warnings.append("NID number could not be extracted from the NID front.")
    if not fields.get("dateOfBirth"):
        warnings.append("Date of birth could not be extracted from the NID front.")
    if not quality_ok:
        warnings.append("Document quality may reduce OCR accuracy.")
    return {"status": "COMPLETED" if best["text"] else "OCR_UNREADABLE", "rawText": best["text"], "fields": fields, "confidence": round(best["confidence"], 4), "warnings": list(dict.fromkeys(warnings))}


def qr_image_variants(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    enhanced = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    threshold = cv2.adaptiveThreshold(enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 9)
    variants = [image, gray, enhanced, threshold]
    for rotation in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE):
        variants.append(cv2.rotate(image, rotation))
        variants.append(cv2.rotate(enhanced, rotation))
    return variants


def decode_qr(image: np.ndarray) -> dict:
    raw = ""
    variants = qr_image_variants(image)
    for variant in variants:
        try:
            result = zxingcpp.read_barcode(variant)
            raw = result.text.strip() if result and result.text else ""
        except Exception:
            raw = ""
        if raw:
            break
    if not raw:
        detector = cv2.QRCodeDetector()
        for variant in variants:
            try:
                raw, _, _ = detector.detectAndDecode(variant)
                raw = raw.strip()
            except cv2.error:
                raw = ""
            if raw:
                break
    if not raw:
        return {"status": "QR_DATA_UNREADABLE", "rawData": "", "fields": {}}
    fields = parse_structured_payload(raw)
    return {"status": "DECODED" if fields else "QR_DATA_NOT_PARSEABLE", "rawData": raw, "fields": fields}


class FaceEngine:
    def __init__(self):
        detector_path = str(MODEL_DIR / "face_detection_yunet_2023mar.onnx")
        recognizer_path = str(MODEL_DIR / "face_recognition_sface_2021dec.onnx")
        self.detector = cv2.FaceDetectorYN.create(detector_path, "", (320, 320), 0.85, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(recognizer_path, "")

    def faces(self, image: np.ndarray) -> list[np.ndarray]:
        height, width = image.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(image)
        return [] if faces is None else list(faces)

    def feature(self, image: np.ndarray, face: np.ndarray) -> np.ndarray:
        return self.recognizer.feature(self.recognizer.alignCrop(image, face))

    def compare(self, nid_image: np.ndarray, live_image: np.ndarray) -> dict:
        nid_faces = self.faces(nid_image)
        live_faces = self.faces(live_image)
        warnings = []
        if len(nid_faces) != 1:
            warnings.append("Exactly one portrait must be visible on the NID front.")
        if len(live_faces) != 1:
            warnings.append("Exactly one live face must be visible.")
        if len(nid_faces) != 1 or len(live_faces) != 1:
            return {"detected": False, "qualityAcceptable": False, "similarity": 0.0, "warnings": warnings}
        live_box = live_faces[0]
        box_size = min(float(live_box[2]), float(live_box[3]))
        quality_ok, quality_warnings = image_quality(live_image)
        if box_size < min(live_image.shape[:2]) * 0.2:
            quality_ok = False
            quality_warnings.append("Live face is too small in the frame.")
        score = self.recognizer.match(self.feature(nid_image, nid_faces[0]), self.feature(live_image, live_faces[0]), cv2.FaceRecognizerSF_FR_COSINE)
        return {"detected": True, "qualityAcceptable": quality_ok, "similarity": round(float(score), 4), "warnings": quality_warnings}


def sharpest_video_frame(video_path: Path, face_engine: FaceEngine) -> np.ndarray | None:
    capture = cv2.VideoCapture(str(video_path))
    best_frame = None
    best_score = -1.0
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % 4 == 0 and len(face_engine.faces(frame)) == 1:
            score = float(cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
            if score > best_score:
                best_score, best_frame = score, frame.copy()
        index += 1
    capture.release()
    return best_frame


def analyze_liveness(video_path: Path, challenge: list[str]) -> dict:
    if os.getenv("IDENTITY_LIVENESS_ENABLED", "true").lower() != "true":
        return {"status": "NOT_AVAILABLE", "warnings": ["Liveness analysis is disabled."]}
    try:
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision

        options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(MODEL_DIR / "face_landmarker.task")),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            output_face_blendshapes=True,
        )
        capture = cv2.VideoCapture(str(video_path))
        fps = capture.get(cv2.CAP_PROP_FPS) or 15
        events = []
        seen = set()
        frame_index = 0
        with vision.FaceLandmarker.create_from_options(options) as landmarker:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if frame_index % 2:
                    frame_index += 1
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(frame_index / fps * 1000))
                if result.face_landmarks:
                    landmarks = result.face_landmarks[0]
                    eye_distance = max(abs(landmarks[263].x - landmarks[33].x), 0.01)
                    yaw_proxy = (landmarks[1].x - (landmarks[33].x + landmarks[263].x) / 2) / eye_distance
                    scores = {item.category_name: item.score for item in (result.face_blendshapes[0] if result.face_blendshapes else [])}
                    blink = (scores.get("eyeBlinkLeft", 0) + scores.get("eyeBlinkRight", 0)) / 2 > 0.45
                    candidates = []
                    if blink:
                        candidates.append("BLINK")
                    if yaw_proxy < -0.13:
                        candidates.append("TURN_LEFT")
                    if yaw_proxy > 0.13:
                        candidates.append("TURN_RIGHT")
                    for event in candidates:
                        if event not in seen:
                            seen.add(event)
                            events.append(event)
                frame_index += 1
        capture.release()
        position = 0
        for event in events:
            if position < len(challenge) and event == challenge[position]:
                position += 1
        passed = position == len(challenge)
        return {"status": "PASS" if passed else "FAIL", "observedActions": events, "warnings": [] if passed else ["Requested actions were not detected in order."]}
    except Exception:
        return {"status": "INCONCLUSIVE", "warnings": ["Liveness analysis could not produce a reliable result."]}


async def analyze(front_url: str, back_url: str | None, liveness_url: str | None, capture_mode: str, challenge: list[str]) -> dict:
    with tempfile.TemporaryDirectory(prefix="financelend-identity-") as directory:
        root = Path(directory)
        front_path, back_path = root / "front", root / "back"
        live_path = root / ("live.jpg" if capture_mode == "selfie" else "live.webm")
        async with httpx.AsyncClient() as client:
            await download_asset(client, front_url, front_path)
            if capture_mode != "document_only":
                if not back_url:
                    raise ValueError("The NID back is required for full identity verification")
                await download_asset(client, back_url, back_path)
            if capture_mode != "document_only":
                if not liveness_url:
                    raise ValueError("Live face evidence is required for full identity verification")
                await download_asset(client, liveness_url, live_path)
        front_image = cv2.imread(str(front_path))
        back_image = cv2.imread(str(back_path)) if capture_mode != "document_only" else None
        if front_image is None or (capture_mode != "document_only" and back_image is None):
            raise ValueError("A required document image could not be decoded")
        ocr = extract_ocr(front_image)
        qr = {"status": "NOT_REQUIRED", "rawData": "", "fields": {}} if capture_mode == "document_only" else decode_qr(back_image)
        if capture_mode == "document_only":
            face = {"detected": False, "qualityAcceptable": False, "similarity": 0.0, "warnings": []}
            liveness = {"status": "NOT_AVAILABLE", "warnings": []}
        else:
            face_engine = FaceEngine()
            live_image = cv2.imread(str(live_path)) if capture_mode == "selfie" else sharpest_video_frame(live_path, face_engine)
            face = {"detected": False, "qualityAcceptable": False, "similarity": 0.0, "warnings": ["A live face frame could not be decoded."]}
            if live_image is not None:
                face = face_engine.compare(front_image, live_image)
            liveness = {"status": "NOT_AVAILABLE", "warnings": ["Selfie fallback does not include liveness."]} if capture_mode == "selfie" else analyze_liveness(live_path, challenge)
        return {
            "ocr": ocr,
            "qr": qr,
            "comparisons": {"nameSimilarity": name_similarity(ocr["fields"].get("name"), qr["fields"].get("name"))},
            "face": face,
            "liveness": liveness,
            "modelVersions": {"ocr": "tesseract-ben-eng", "qr": "zxing-cpp-2.3", "faceDetector": "yunet-2023mar", "faceRecognizer": "sface-2021dec", "liveness": "mediapipe-face-landmarker-v1"},
        }
