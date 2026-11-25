# Nepal Vehicle Detection Module (Park-Mandu)

An end-to-end YOLOv8 object detection module trained to detect vehicles in Nepal's traffic environment, developed as part of the **Park-Mandu** intelligent parking management and enforcement ecosystem.

---

## 1. Project Overview

The **Park-Mandu Vehicle Detection Module** provides real-time vehicle localization and classification across complex urban street conditions. The model detects typical vehicle types found on Nepali roads (cars, motorcycles, buses, trucks, and other local vehicles like auto-rickshaws and tempos) to support automated parking occupancy monitoring, parking enforcement, and vehicle tracking.

This module contains:
- Fine-tuned **YOLOv8n** model weights (`best.pt` and `last.pt`)
- Complete training, validation, and evaluation pipeline notebook
- Comprehensive evaluation metrics, confusion matrices, and visual prediction samples
- Inference script and dependency configuration

---

## 2. YOLOv8 Model Information

| Attribute | Specification |
| :--- | :--- |
| **Model Family** | YOLOv8 (Ultralytics) |
| **Architecture Variant** | YOLOv8n (Nano) |
| **Task** | Object Detection (Bounding Box) |
| **Input Image Size** | 640 × 640 |
| **Model Parameters** | 3,011,000 (~3.01 M) |
| **Computational Complexity** | 8.2 GFLOPs |
| **Training Framework** | Ultralytics 8.4.187 / PyTorch 2.11.0+cu130 |
| **Hardware** | NVIDIA Tesla T4 GPU (CUDA:0, 14,913 MiB) |
| **Training Epochs** | 30 epochs (batch size 8, seed 42) |
| **Primary Checkpoint** | `models/best.pt` (selected on validation mAP@50-95) |
| **Final Checkpoint** | `models/last.pt` (final epoch checkpoint) |

---

## 3. Vehicle Classes Detected

The model classifies vehicles into **5 distinct classes**:

| Class ID | Class Name | Description | Included Vehicles |
| :---: | :--- | :--- | :--- |
| **0** | `car` | Standard passenger vehicles | Sedans, hatchbacks, SUVs, jeeps, cabs, private cars |
| **1** | `motorcycle` | Two-wheeled motorized transport | Motorbikes, scooters, scooties |
| **2** | `bus` | High-occupancy passenger vehicles | City buses, minibuses, public transit coaches |
| **3** | `truck` | Goods carriage and freight vehicles | Medium trucks, heavy trucks, tippers, container carriers, pickups |
| **4** | `other_vehicle` | Specialized & localized transit | Auto-rickshaws, tempos (electric/safari), tractors, microbuses |

---

## 4. Dataset & Training Overview

### Dataset Consolidation & Deduplication
The training dataset was consolidated from 6 distinct vehicle datasets:
1. `car_detection.zip`
2. `car_object_detection.zip`
3. `vehicle_dataset_1.zip`
4. `vehicle_detection_count.zip`
5. `vehicle_object_recognition.zip`
6. `vehicles_dataset.zip`

All source class labels were mapped and standardized into the 5 target classes. Strict deduplication was executed by processing test splits first, then validation, then training, ensuring that no duplicate images leaked across splits.

### Dataset Splits

| Split | Images | Labels | Percentage |
| :--- | :---: | :---: | :---: |
| **Train** | 5,676 | 5,676 | 73.9% |
| **Validation** | 1,243 | 1,243 | 16.2% |
| **Test** | 759 | 759 | 9.9% |
| **Total** | **7,678** | **7,678** | **100.0%** |

### Class Distribution (Ground Truth Annotations)

| Class | Bounding Boxes | Proportion |
| :--- | :---: | :---: |
| `car` | 54,383 | 84.08% |
| `motorcycle` | 4,885 | 7.55% |
| `bus` | 1,714 | 2.65% |
| `truck` | 1,647 | 2.55% |
| `other_vehicle` | 2,049 | 3.17% |
| **Total Annotations** | **64,678** | **100.0%** |

### Training Configuration
- **Base model**: `yolov8n.pt` (COCO pretrained)
- **Input resolution**: 640 × 640
- **Epochs**: 30
- **Batch size**: 8
- **Optimizer**: auto (SGD/AdamW with momentum 0.937, weight decay 0.0005)
- **Learning rate**: `lr0=0.01`, `lrf=0.01`
- **Loss gains**: `box=7.5`, `cls=0.5`, `dfl=1.5`
- **Mosaic augmentation**: enabled (closed during last 10 epochs)

---

## 5. Evaluation Results

Evaluation was performed on the unseen **test split** containing 759 images.

### Overall Performance Metrics

| Metric | Score | Percentage |
| :--- | :---: | :---: |
| **Precision (P)** | 0.8619 | 86.19% |
| **Recall (R)** | 0.8388 | 83.88% |
| **F1-Score** | 0.8502 | 85.02% |
| **mAP@50** | 0.8894 | 88.94% |
| **mAP@50-95** | 0.6527 | 65.27% |
| **Macro Precision** | 0.8619 | 86.19% |
| **Macro Recall** | 0.8388 | 83.88% |
| **Macro F1-Score** | 0.8484 | 84.84% |

### Per-Class Test Performance

| Class | Precision | Recall | F1-Score | mAP@50 | mAP@50-95 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **car** | 0.9195 | 0.8693 | 0.8937 | 0.9482 | 0.7259 |
| **motorcycle** | 0.8694 | 0.8235 | 0.8458 | 0.8679 | 0.6007 |
| **bus** | 0.8367 | 0.8795 | 0.8576 | 0.8982 | 0.6639 |
| **truck** | 0.7946 | 0.8730 | 0.8320 | 0.8858 | 0.6528 |
| **other_vehicle** | 0.8892 | 0.7489 | 0.8130 | 0.8469 | 0.6201 |

### Evaluation Artifacts
Detailed visual evaluation results are saved in `results/`:
- **`results/yolov8_vehicle_test/`**:
  - `BoxF1_curve.png` — F1 score confidence curve across thresholds
  - `BoxP_curve.png` — Precision-confidence curve
  - `BoxR_curve.png` — Recall-confidence curve
  - `BoxPR_curve.png` — Precision-Recall (PR) curve
  - `confusion_matrix.png` & `confusion_matrix_normalized.png` — Detailed class confusion matrix
  - `val_batch*_pred.jpg` & `val_batch*_labels.jpg` — Prediction vs. ground-truth comparisons
- **`results/sample_predictions/`**:
  - Qualitative model detections on unseen urban scenes
- **`results/*.csv`**:
  - Raw and final calculated metrics summaries

---

## 6. Project Folder Structure

```text
vehicle_detection/
├── .gitignore                    # Ignore virtual environments, caches, datasets, logs
├── README.md                     # Comprehensive module documentation
├── requirements.txt              # Module dependencies
├── model_info.txt                # Model specifications and performance summary
├── models/
│   ├── best.pt                   # Selected YOLOv8 checkpoint (highest validation mAP)
│   ├── last.pt                   # Checkpoint from final training epoch (epoch 30)
│   ├── data.yaml                 # YOLO dataset configuration
│   └── predict.py                # Standalone CLI inference script
├── notebooks/
│   └── Vehicle_detection.ipynb   # Complete pipeline notebook (data prep, training, eval)
└── results/
    ├── final_calculated_metrics.csv   # Aggregated overall and macro metrics
    ├── final_per_class_metrics.csv    # Per-class P, R, F1, mAP@50, mAP@50-95
    ├── per_class_test_metrics.csv     # Per-class test evaluation metrics
    ├── test_metrics_summary.csv       # Summary test evaluation metrics
    ├── sample_predictions/            # Test inference sample images
    │   ├── 0eb988b15a9e0498.jpg
    │   ├── 1a0b09c533aabceb.jpg
    │   ├── 7e1b1e3c589a9b45.jpg
    │   ├── 9411d3dcf1688ca1.jpg
    │   ├── 9797e021d31a4757.jpg
    │   ├── 9b4b7e6e673906c7.jpg
    │   ├── bdaecb7e920b6c29.jpg
    │   ├── d77831fabc38d427.jpg
    │   ├── e613b5563abe2cbb.jpg
    │   └── fd119090a3a03c47.jpg
    └── yolov8_vehicle_test/           # Metric plots and validation batches
        ├── BoxF1_curve.png
        ├── BoxPR_curve.png
        ├── BoxP_curve.png
        ├── BoxR_curve.png
        ├── confusion_matrix.png
        ├── confusion_matrix_normalized.png
        ├── val_batch0_labels.jpg
        ├── val_batch0_pred.jpg
        ├── val_batch1_labels.jpg
        ├── val_batch1_pred.jpg
        ├── val_batch2_labels.jpg
        └── val_batch2_pred.jpg
```

---

## 7. Installation & Usage

### 1. Environment Setup

Create and activate a Python virtual environment (Python 3.10+ recommended):

```bash
# Navigate to the vehicle_detection directory
cd vehicle_detection

# Create virtual environment
python -m venv .venv

# Activate environment
# On Linux/macOS:
source .venv/bin/activate
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Windows (CMD):
.venv\Scripts\activate.bat

# NVIDIA GPU: install the CUDA build of PyTorch first (the default Windows package is CPU-only)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130

# Install dependencies
pip install -r requirements.txt

# Check the GPU is used: expect a version ending in +cu130, then True
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

**Run the AI on the GPU.** It needs an NVIDIA GPU with driver 580 or newer. If the check shows `+cpu`,
run `pip uninstall -y torch torchvision` and repeat the CUDA install line. Without an NVIDIA GPU, skip
that line. To run the live camera detector on the GPU, from the project folder:

```powershell
.\vehicle_detection\.venv\Scripts\python camera-bridge\bridge.py --device 0 --source "Road parking Test video.mp4" --camera-code CAM-021
```

### 2. Command-Line Inference

The `models/predict.py` script enables quick inference on images, videos, or camera feeds:

```bash
# Run detection on an image
python models/predict.py --source path/to/image.jpg

# Run detection with custom confidence threshold (e.g., 0.40)
python models/predict.py --source path/to/image.jpg --conf 0.40

# Run detection on a video
python models/predict.py --source path/to/traffic.mp4

# Run detection on a live webcam/RTSP stream
python models/predict.py --source 0
```

Detection outputs will be saved to `results/predictions/` by default.

### 3. Python API Usage

```python
from pathlib import Path
from ultralytics import YOLO

# Load the trained model
model_path = Path("models/best.pt")
model = YOLO(str(model_path))

# Print registered classes
print("Classes:", model.names)
# {0: 'car', 1: 'motorcycle', 2: 'bus', 3: 'truck', 4: 'other_vehicle'}

# Perform inference on an image
results = model.predict(source="path/to/image.jpg", conf=0.25, save=True)

# Process detections
for result in results:
    for box in result.boxes:
        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])
        coords = box.xyxy[0].tolist()
        print(f"Detected {model.names[cls_id]} ({confidence:.2f}) at {coords}")
```

---

## 8. Important Notes

- **Scope**: This module handles vehicle detection and bounding box localization. It does not independently determine parking legality, assign parking spots, or read license plates.
- **Integration**: To integrate this module into Park-Mandu's enforcement pipelines, refer to the `park-track` service located at the project root.
