import cv2
import numpy as np
from PIL import Image

from app.engine import bounded_image, decode_qr, load_image, looks_like_nid_back, merge_ocr_fields, parse_ocr_fields, targeted_date_from_ocr_data, targeted_nid_from_ocr_data, text_from_ocr_data


def test_phone_photo_loader_applies_exif_orientation(tmp_path):
    path = tmp_path / "phone-photo.jpg"
    image = Image.new("RGB", (40, 20), "white")
    exif = image.getexif()
    exif[274] = 6
    image.save(path, exif=exif)
    loaded = load_image(path)
    assert loaded is not None
    assert loaded.shape[:2] == (40, 20)


def test_large_phone_photo_is_bounded_for_free_ai_memory():
    image = np.zeros((3000, 4000, 3), dtype=np.uint8)
    resized = bounded_image(image, 1800)
    assert resized.shape[:2] == (1350, 1800)


def test_front_ocr_accepts_month_name_date():
    fields = parse_ocr_fields("Name: Test Buyer\nNID No: 1234567890\nDate of Birth: 31 Dec 2002")
    assert fields == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_front_ocr_accepts_full_month_and_bengali_digits():
    fields = parse_ocr_fields("Name: Test Buyer\nNID: ১২৩৪৫৬৭৮৯০\nDate of Birth: ৩১ December ২০০২")
    assert fields == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_front_ocr_accepts_nid_date_with_semicolon_label():
    fields = parse_ocr_fields("Name: Tafi Sheikh\nID NO: 63849492839\nDate of Birth; 07 Jan 2002")
    assert fields == {"name": "TAFI SHEIKH", "nidNumber": "63849492839", "dateOfBirth": "2002-01-07"}


def test_front_ocr_tolerates_captured_photo_birth_and_month_mistakes():
    fields = parse_ocr_fields("Name: Imtiaz Ahmed\nID NO: 6463188984\nDate of Binh 31 Deo 2002")
    assert fields == {"name": "IMTIAZ AHMED", "nidNumber": "6463188984", "dateOfBirth": "2002-12-31"}


def test_front_ocr_accepts_camera_inserted_date_punctuation():
    fields = parse_ocr_fields("Name: IMTIAZ AHMED\nDate’ of Birth>31'Dec2002\nID NO: 6463188984")
    assert fields == {"name": "IMTIAZ AHMED", "nidNumber": "6463188984", "dateOfBirth": "2002-12-31"}


def test_ocr_attempts_keep_the_strongest_name_and_consistent_identity_fields():
    attempts = [
        {"confidence": 0.87, "fields": {"name": "TAF SHEIKH", "nidNumber": "63849492839", "dateOfBirth": "2002-01-07"}},
        {"confidence": 0.75, "fields": {"name": "F AR K", "nidNumber": "63849492839"}},
        {"confidence": 0.71, "fields": {"name": "TAFI SHEIKH", "nidNumber": "63849492839"}},
    ]
    assert merge_ocr_fields(attempts) == {
        "name": "TAFI SHEIKH",
        "nidNumber": "63849492839",
        "dateOfBirth": "2002-01-07",
    }


def test_back_side_print_date_is_never_treated_as_date_of_birth():
    text = "রক্তের গ্রুপ/ Blood Group: O+ জন্মস্থান: ময়মনসিংহ মুদ্রণ: 01 Nov 2025"
    assert looks_like_nid_back(text) is True
    assert "dateOfBirth" not in parse_ocr_fields(text)


def test_real_nid_layout_prefers_english_name_and_mixed_dob_separator():
    text = """National ID Card / জাতীয় পরিচয় পত্র
নাম: ইমতিয়াজ আহাম্মেদ
বি =, Name:/ IMTIAZ AHMED
Date of Birth:31 Dec-2002
ID NO: 6463188984"""
    assert parse_ocr_fields(text) == {
        "name": "IMTIAZ AHMED",
        "nidNumber": "6463188984",
        "dateOfBirth": "2002-12-31",
    }


def test_reconstructs_ocr_lines_without_a_second_tesseract_pass():
    data = {
        "text": ["Name:", "Demo", "Buyer", "", "NID:", "1234567890"],
        "block_num": [1, 1, 1, 1, 1, 1],
        "par_num": [1, 1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 1, 2, 2],
    }
    assert text_from_ocr_data(data) == "Name: Demo Buyer\nNID: 1234567890"


def test_targeted_nid_uses_the_number_line_coordinates(monkeypatch):
    data = {
        "text": ["Date", "01", "Dec", "1999", "NID", "No", "334", "408", "9875"],
        "block_num": [1] * 9,
        "par_num": [1] * 9,
        "line_num": [1, 1, 1, 1, 2, 2, 2, 2, 2],
        "left": [5, 50, 80, 120, 5, 45, 90, 145, 200],
        "top": [10, 10, 10, 10, 60, 60, 60, 60, 60],
        "width": [35, 20, 30, 45, 35, 35, 45, 45, 55],
        "height": [20] * 9,
    }
    monkeypatch.setattr("app.engine.pytesseract.image_to_string", lambda *args, **kwargs: "331 408 9875")
    assert targeted_nid_from_ocr_data(np.full((120, 320), 255, dtype=np.uint8), data) == "3314089875"


def test_targeted_date_recovers_a_bad_initial_phone_ocr_line(monkeypatch):
    data = {
        "text": ["Date", "of", "Binh", "31", "Deo", "2600"],
        "block_num": [1] * 6, "par_num": [1] * 6, "line_num": [1] * 6,
        "left": [5, 50, 75, 125, 155, 205], "top": [20] * 6,
        "width": [40, 20, 45, 25, 40, 55], "height": [22] * 6,
    }
    monkeypatch.setattr("app.engine.pytesseract.image_to_string", lambda *args, **kwargs: "Date of Birth 31 Dec 2002")
    assert targeted_date_from_ocr_data(np.full((90, 300), 255, dtype=np.uint8), data) == "2002-12-31"


def make_qr(payload: str) -> np.ndarray:
    encoded = cv2.QRCodeEncoder_create().encode(payload)
    return cv2.cvtColor(cv2.resize(encoded, (720, 720), interpolation=cv2.INTER_NEAREST), cv2.COLOR_GRAY2BGR)


def test_rotated_qr_is_decoded_and_parsed():
    image = cv2.rotate(make_qr('{"name":"Test Buyer","nid":"1234567890","dob":"31 Dec 2002"}'), cv2.ROTATE_90_CLOCKWISE)
    result = decode_qr(image)
    assert result["status"] == "DECODED"
    assert result["fields"] == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_low_contrast_qr_is_enhanced_before_decoding():
    image = make_qr("Name: Test Buyer|NID: 1234567890|DOB: 31 Dec 2002")
    low_contrast = cv2.convertScaleAbs(image, alpha=0.28, beta=150)
    result = decode_qr(low_contrast)
    assert result["status"] == "DECODED"
    assert result["fields"]["dateOfBirth"] == "2002-12-31"


def test_opaque_qr_never_returns_identity_fields():
    result = decode_qr(make_qr("opaque-encrypted-data"))
    assert result["status"] == "QR_DATA_NOT_PARSEABLE"
    assert result["fields"] == {}
