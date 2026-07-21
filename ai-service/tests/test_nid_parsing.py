import cv2
import numpy as np

from app.engine import decode_qr, looks_like_nid_back, merge_ocr_fields, parse_ocr_fields, text_from_ocr_data


def test_front_ocr_accepts_month_name_date():
    fields = parse_ocr_fields("Name: Test Buyer\nNID No: 1234567890\nDate of Birth: 31 Dec 2002")
    assert fields == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_front_ocr_accepts_full_month_and_bengali_digits():
    fields = parse_ocr_fields("Name: Test Buyer\nNID: ১২৩৪৫৬৭৮৯০\nDate of Birth: ৩১ December ২০০২")
    assert fields == {"name": "TEST BUYER", "nidNumber": "1234567890", "dateOfBirth": "2002-12-31"}


def test_front_ocr_accepts_nid_date_with_semicolon_label():
    fields = parse_ocr_fields("Name: Tafi Sheikh\nID NO: 63849492839\nDate of Birth; 07 Jan 2002")
    assert fields == {"name": "TAFI SHEIKH", "nidNumber": "63849492839", "dateOfBirth": "2002-01-07"}


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
