FluentRead manga processing uses the following open-source components:

- ppu-paddle-ocr 6.6.0, MIT, https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr
- ppu-ocv 4.0.0, MIT, included through ppu-paddle-ocr
- ONNX Runtime Web 1.23.2, MIT, https://github.com/microsoft/onnxruntime
  Its original third-party notices are included in third-party-notices/.

Model data is downloaded separately, not bundled as executable code:

- PaddleOCR PP-OCRv6 small detection/recognition and its dictionary, Apache-2.0.
  Original: https://github.com/PaddlePaddle/PaddleOCR
  ONNX conversion: https://huggingface.co/snowfluke/ppu-paddle-ocr-models
  Fixed revision: bf1d5edb0335d3262be7caf13f766ba274b4cadd
- Dynamic LaMa manga inpainting, Apache-2.0.
  Original: https://github.com/advimman/lama
  ONNX model: https://huggingface.co/ogkalu/lama-manga-onnx-dynamic
  Fixed revision: ee4ed4a8447b6730fc41d34f90876b6c48af925a

Files obtained from the optional hf-mirror.net mirror or offline import must
match the same fixed sizes and SHA-256 hashes before use. The mirror is an
independent third party. Model requests include no images, translation text,
credentials, or referrer. No model code or remote scripts are executed.

Model artifacts keep their original licenses. The full Apache-2.0 license is
included in third-party-notices/manga-models-Apache-2.0.txt.
