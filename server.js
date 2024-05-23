const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpeg = require('ffmpeg.js');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.post('/upload', upload.single('video'), async (req, res) => {
    const videoPath = req.file.path;
    const framesDir = 'frames';
    const redactedFramesDir = 'redacted_frames';

    // Extract frames from video
    await extractFrames(videoPath, framesDir);

    // Perform OCR and redact text using Python script
    await anonymizeFramesWithPython(framesDir, redactedFramesDir);

    // Reassemble video
    const redactedVideoPath = 'public/redacted_video.mp4';
    await reassembleVideo(redactedFramesDir, redactedVideoPath);

    res.json({ redactedVideoUrl: '/redacted_video.mp4' });
});

async function extractFrames(videoPath, outputDir) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    const data = fs.readFileSync(videoPath);
    const result = ffmpeg({
        MEMFS: [{ name: 'input.mp4', data: new Uint8Array(data) }],
        arguments: ['-i', 'input.mp4', '-vf', 'fps=1', path.join(outputDir, 'frame_%03d.jpg')],
    });

    if (result.stderr) {
        console.error(result.stderr);
    }

    result.MEMFS.forEach((file) => {
        if (file.name.endsWith('.jpg')) {
            fs.writeFileSync(path.join(outputDir, file.name), Buffer.from(file.data));
        }
    });
}

async function anonymizeFramesWithPython(framesDir, redactedFramesDir) {
    return new Promise((resolve, reject) => {
        exec(`python3 anonymize_frames.py ${framesDir} ${redactedFramesDir}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return reject(error);
            }
            if (stderr) {
                console.error(`Stderr: ${stderr}`);
                return reject(new Error(stderr));
            }
            console.log(`Stdout: ${stdout}`);
            resolve(stdout);
        });
    });
}

async function reassembleVideo(frameDir, outputVideoPath) {
    const frameFiles = fs.readdirSync(frameDir).filter(file => file.endsWith('.jpg'));
    if (frameFiles.length === 0) {
        throw new Error('No frames found for reassembly.');
    }

    const MEMFS = frameFiles.map(file => ({
        name: file,
        data: new Uint8Array(fs.readFileSync(path.join(frameDir, file))),
    }));

    const result = ffmpeg({
        MEMFS: MEMFS,
        arguments: ['-framerate', '1', '-i', 'frame_%03d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'output.mp4'],
    });

    const output = result.MEMFS.find(file => file.name === 'output.mp4');
    if (output) {
        fs.writeFileSync(outputVideoPath, Buffer.from(output.data));
    } else {
        console.error(result.stderr);
        throw new Error('Output video file not found.');
    }
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
