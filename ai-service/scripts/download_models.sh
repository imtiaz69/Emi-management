#!/bin/sh
set -eu

mkdir -p "${MODEL_DIR:-/app/models}"
base="${MODEL_DIR:-/app/models}"

curl -fL --retry 3 -o "$base/face_detection_yunet_2023mar.onnx" \
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
curl -fL --retry 3 -o "$base/face_recognition_sface_2021dec.onnx" \
  "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
curl -fL --retry 3 -o "$base/face_landmarker.task" \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

echo "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  $base/face_detection_yunet_2023mar.onnx" | sha256sum -c -
echo "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79  $base/face_recognition_sface_2021dec.onnx" | sha256sum -c -
echo "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  $base/face_landmarker.task" | sha256sum -c -
