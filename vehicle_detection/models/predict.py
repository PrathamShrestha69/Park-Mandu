from pathlib import Path
import argparse
from ultralytics import YOLO

MODEL_PATH = Path(__file__).parent / "best.pt"

def main():
    parser = argparse.ArgumentParser(
        description="Nepal Vehicle Detection using YOLOv8"
    )
    parser.add_argument(
        "--source", required=True,
        help="Image path, video path, or camera index such as 0"
    )
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--output", default="results")
    args = parser.parse_args()

    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Missing model: {MODEL_PATH}")

    model = YOLO(str(MODEL_PATH))

    print("Model loaded:", MODEL_PATH)
    print("Vehicle classes:", model.names)

    source = int(args.source) if args.source.isdigit() else args.source

    model.predict(
        source=source,
        conf=args.conf,
        save=True,
        project=args.output,
        name="predictions",
        exist_ok=True
    )

if __name__ == "__main__":
    main()
