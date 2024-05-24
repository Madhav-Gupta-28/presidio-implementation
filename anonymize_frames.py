import os
import sys
from PIL import Image
from presidio_image_redactor import ImageRedactorEngine

def redact_image(image_path, output_path):
    image = Image.open(image_path)

    # Initialize the engine
    engine = ImageRedactorEngine()

    # Redact the image with pink color
    redacted_image = engine.redact(image, (255, 192, 203))

    # Save the redacted image
    redacted_image.save(output_path)
    
    print(f"Redacted image saved at {redact_image}")

def main(frames_dir, redacted_frames_dir):
    if not os.path.exists(redacted_frames_dir):
        os.makedirs(redacted_frames_dir)

    frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith('.jpg')])
    for frame_file in frame_files:
        frame_path = os.path.join(frames_dir, frame_file)
        redacted_frame_path = os.path.join(redacted_frames_dir, frame_file)
        redact_image(frame_path, redacted_frame_path)

if __name__ == "__main__":
    frames_dir = sys.argv[1]
    redacted_frames_dir = sys.argv[2]
    main(frames_dir, redacted_frames_dir)
