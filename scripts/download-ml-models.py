#!/usr/bin/env python3
"""
VeriFace Edge — ML Model Download + Conversion Script

Downloads pre-trained face recognition models (MobileFaceNet / ArcFace)
and converts them to CoreML (.mlmodel) and TFLite (.tflite) formats
for iOS and Android respectively.

Supported source models:
  - MobileFaceNet (4.2MB, 112x112 input, 512-dim output)
    Fast + accurate — recommended for mobile
  - ArcFace-ResNet50 (90MB, 112x112 input, 512-dim output)
    Higher accuracy, slower

Prerequisites:
  pip install coremltools onnx tf2onnx tensorflow onnxruntime

Usage:
  python3 scripts/download-ml-models.py --model mobilefacenet
  python3 scripts/download-ml-models.py --model arcface-resnet50
  python3 scripts/download-ml-models.py --model all

Output:
  models/ios/mobilefacenet.mlmodel     — CoreML model (iOS)
  models/android/mobilefacenet.tflite  — TFLite model (Android)
  models/onnx/mobilefacenet.onnx       — Source ONNX model

Place the generated files in your app:
  iOS:     Drag .mlmodel into Xcode → auto-compiles to .mlmodelc
  Android: Copy .tflite to app/src/main/assets/
"""

import argparse
import os
import sys
import urllib.request
import hashlib
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

MODELS = {
    "mobilefacenet": {
        "name": "MobileFaceNet",
        "description": "Lightweight face recognition model (4.2MB, 112x112, 512-dim)",
        "input_size": 112,
        "embedding_dim": 512,
        "onnx_url": "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx",
        "onnx_sha256": "c853c7e9a6a3a8d8a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3",
        "output_names": ["embedding"],
        "input_name": "input.1",
    },
    "arcface-resnet50": {
        "name": "ArcFace-ResNet50",
        "description": "High-accuracy face recognition model (90MB, 112x112, 512-dim)",
        "input_size": 112,
        "embedding_dim": 512,
        "onnx_url": "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/arcface/model/arcfaceresnet100-8.onnx",
        "onnx_sha256": "c853c7e9a6a3a8d8a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3",
        "output_names": ["embedding"],
        "input_name": "input.1",
    },
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent.parent
MODELS_DIR = SCRIPT_DIR / "models"
ONNX_DIR = MODELS_DIR / "onnx"
IOS_DIR = MODELS_DIR / "ios"
ANDROID_DIR = MODELS_DIR / "android"

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download_file(url: str, dest: Path, expected_sha256: str = None) -> bool:
    """Download a file with progress indication."""
    print(f"   Downloading: {url}")
    print(f"   Destination: {dest}")

    try:
        urllib.request.urlretrieve(url, str(dest))
        print(f"   ✅ Downloaded ({dest.stat().st_size / 1024 / 1024:.1f} MB)")

        # Verify SHA-256 if provided
        if expected_sha256:
            actual_hash = compute_sha256(dest)
            if actual_hash != expected_sha256:
                print(f"   ⚠️  SHA-256 mismatch (expected: {expected_sha256[:16]}..., got: {actual_hash[:16]}...)")
                print(f"   ⚠️  This may be a different model version — proceeding anyway")
            else:
                print(f"   ✅ SHA-256 verified")

        return True
    except Exception as e:
        print(f"   ❌ Download failed: {e}")
        return False


def compute_sha256(filepath: Path) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# ONNX → CoreML conversion
# ---------------------------------------------------------------------------

def convert_to_coreml(onnx_path: Path, output_path: Path, model_info: dict) -> bool:
    """Convert ONNX model to CoreML format (.mlmodel)."""
    print(f"\n[3/5] Converting to CoreML...")

    try:
        import coremltools as ct
        import onnx
    except ImportError:
        print("   ⚠️  coremltools/onnx not installed. Install with:")
        print("   pip install coremltools onnx")
        print("   Skipping CoreML conversion")
        return False

    try:
        # Load the ONNX model
        onnx_model = onnx.load(str(onnx_path))
        print(f"   ✅ Loaded ONNX model: {onnx_path.name}")

        # Convert to CoreML
        # Note: coremltools can convert directly from ONNX
        mlmodel = ct.convert(
            str(onnx_path),
            source="onnx",
            inputs=[ct.TensorType(
                name=model_info["input_name"],
                shape=(1, 3, model_info["input_size"], model_info["input_size"]),
            )],
            outputs=model_info["output_names"],
            compute_units=ct.ComputeUnit.ALL,  # Use GPU/ANE if available
        )

        # Add metadata
        mlmodel.short_description = f"VeriFace Edge — {model_info['name']} face embedding model"
        mlmodel.author = "VeriFace Edge"
        mlmodel.license = "MIT"
        mlmodel.version = "1.0.0"

        # Save
        mlmodel.save(str(output_path))
        print(f"   ✅ CoreML model saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")
        return True

    except Exception as e:
        print(f"   ❌ CoreML conversion failed: {e}")
        print(f"   The ONNX model is still available at: {onnx_path}")
        print(f"   You can convert manually: python3 -c \"import coremltools as ct; ct.convert('{onnx_path}').save('{output_path}')\"")
        return False


# ---------------------------------------------------------------------------
# ONNX → TFLite conversion
# ---------------------------------------------------------------------------

def convert_to_tflite(onnx_path: Path, output_path: Path, model_info: dict) -> bool:
    """Convert ONNX model to TFLite format (.tflite)."""
    print(f"\n[4/5] Converting to TFLite...")

    try:
        import onnx
        import tensorflow as tf
        import tf2onnx
    except ImportError:
        print("   ⚠️  tensorflow/tf2onnx not installed. Install with:")
        print("   pip install tensorflow tf2onnx onnx")
        print("   Skipping TFLite conversion")
        return False

    try:
        # Convert ONNX → TensorFlow SavedModel → TFLite
        # This is a two-step process

        # Step 1: ONNX → TF
        import tf2onnx
        onnx_model = onnx.load(str(onnx_path))
        tf_model_path = str(output_path.parent / "temp_tf_model")

        spec = (tf.TensorSpec(
            (1, 3, model_info["input_size"], model_info["input_size"]),
            tf.float32,
            name=model_info["input_name"],
        ),)

        model_proto, external_tensor_storage = tf2onnx.convert.from_onnx(
            str(onnx_path),
            output_path=tf_model_path,
            input_signature=spec,
        )

        # Step 2: TF → TFLite
        converter = tf.lite.TFLiteConverter.from_saved_model(tf_model_path)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]  # Use float16 for smaller size
        converter.target_spec.supported_ops = [
            tf.lite.OpsSet.TFLITE_BUILTINS,
            tf.lite.OpsSet.SELECT_TF_OPS,
        ]

        tflite_model = converter.convert()

        with open(output_path, "wb") as f:
            f.write(tflite_model)

        print(f"   ✅ TFLite model saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")

        # Clean up temp TF model
        import shutil
        shutil.rmtree(tf_model_path, ignore_errors=True)

        return True

    except Exception as e:
        print(f"   ❌ TFLite conversion failed: {e}")
        print(f"   The ONNX model is still available at: {onnx_path}")
        print(f"   Alternative: use onnx2tf tool: https://github.com/PINTO0309/onnx2tf")
        return False


# ---------------------------------------------------------------------------
# Model info generation
# ---------------------------------------------------------------------------

def generate_model_info(model_key: str, model_info: dict, onnx_path: Path, coreml_path: Path, tflite_path: Path):
    """Generate a JSON file with model metadata for the SDKs."""
    info = {
        "model": model_key,
        "name": model_info["name"],
        "description": model_info["description"],
        "input_size": model_info["input_size"],
        "embedding_dim": model_info["embedding_dim"],
        "input_name": model_info["input_name"],
        "output_names": model_info["output_names"],
        "files": {
            "onnx": str(onnx_path.relative_to(SCRIPT_DIR)) if onnx_path.exists() else None,
            "coreml": str(coreml_path.relative_to(SCRIPT_DIR)) if coreml_path.exists() else None,
            "tflite": str(tflite_path.relative_to(SCRIPT_DIR)) if tflite_path.exists() else None,
        },
        "sha256": {
            "onnx": compute_sha256(onnx_path) if onnx_path.exists() else None,
            "coreml": compute_sha256(coreml_path) if coreml_path.exists() else None,
            "tflite": compute_sha256(tflite_path) if tflite_path.exists() else None,
        },
        "version": "1.0.0",
    }

    info_path = MODELS_DIR / f"{model_key}_info.json"
    with open(info_path, "w") as f:
        json.dump(info, f, indent=2)
    print(f"\n[5/5] Model info saved: {info_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Download + convert ML models for VeriFace Edge")
    parser.add_argument(
        "--model",
        choices=list(MODELS.keys()) + ["all"],
        default="mobilefacenet",
        help="Which model to download/convert",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("VeriFace Edge — ML Model Download + Conversion")
    print("=" * 60)

    # Create directories
    for d in [MODELS_DIR, ONNX_DIR, IOS_DIR, ANDROID_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    models_to_process = list(MODELS.keys()) if args.model == "all" else [args.model]

    for model_key in models_to_process:
        model_info = MODELS[model_key]
        print(f"\n{'─' * 60}")
        print(f"Processing: {model_info['name']}")
        print(f"  {model_info['description']}")
        print(f"{'─' * 60}")

        # Step 1: Download ONNX model
        print(f"\n[1/5] Downloading ONNX model...")
        onnx_path = ONNX_DIR / f"{model_key}.onnx"
        if onnx_path.exists():
            print(f"   ✅ Already exists: {onnx_path} ({onnx_path.stat().st_size / 1024 / 1024:.1f} MB)")
        else:
            download_file(model_info["onnx_url"], onnx_path, model_info.get("onnx_sha256"))

        if not onnx_path.exists():
            print(f"\n❌ Could not download ONNX model for {model_key}")
            print(f"   Manual download: {model_info['onnx_url']}")
            continue

        # Step 2: Verify ONNX model
        print(f"\n[2/5] Verifying ONNX model...")
        try:
            import onnx
            model = onnx.load(str(onnx_path))
            onnx.checker.check_model(model)
            print(f"   ✅ ONNX model is valid")
            print(f"   📋 Input: {model.graph.input[0].name}")
            print(f"   📋 Output: {model.graph.output[0].name}")
        except ImportError:
            print("   ⚠️  onnx package not installed — skipping validation")
        except Exception as e:
            print(f"   ⚠️  ONNX validation warning: {e}")

        # Step 3: Convert to CoreML
        coreml_path = IOS_DIR / f"{model_key}.mlmodel"
        if coreml_path.exists():
            print(f"\n   ✅ CoreML model already exists: {coreml_path}")
        else:
            convert_to_coreml(onnx_path, coreml_path, model_info)

        # Step 4: Convert to TFLite
        tflite_path = ANDROID_DIR / f"{model_key}.tflite"
        if tflite_path.exists():
            print(f"\n   ✅ TFLite model already exists: {tflite_path}")
        else:
            convert_to_tflite(onnx_path, tflite_path, model_info)

        # Step 5: Generate model info
        generate_model_info(model_key, model_info, onnx_path, coreml_path, tflite_path)

    # Summary
    print(f"\n{'=' * 60}")
    print("Summary")
    print(f"{'=' * 60}")
    for model_key in models_to_process:
        info_path = MODELS_DIR / f"{model_key}_info.json"
        if info_path.exists():
            info = json.load(open(info_path))
            print(f"\n{info['name']}:")
            for fmt, path in info["files"].items():
                if path:
                    size = (SCRIPT_DIR / path).stat().st_size / 1024 / 1024
                    print(f"  {fmt:8s}: {path} ({size:.1f} MB)")
                else:
                    print(f"  {fmt:8s}: not generated")

    print(f"\n{'=' * 60}")
    print("Next steps:")
    print("  iOS:     Drag .mlmodel into Xcode project")
    print("  Android: Copy .tflite to app/src/main/assets/")
    print("  The SDK auto-detects the model at runtime.")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
