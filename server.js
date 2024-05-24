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
    const redactedVideoPath = 'public';
    await reassembleVideo(redactedFramesDir, redactedVideoPath);

    res.json({ redactedVideoUrl: '/redacted_video.mp4' });
});

async function extractFrames(videoPath, outputDir) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }

    // Correctly format the FFmpeg command
    const command = [
        'ffmpeg',
        '-i', videoPath,
        `-vf`, 'fps=1',
        `${outputDir}/frame_%03d.jpg`
    ].join(' ');

    // Execute the FFmpeg command
    const result = exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing FFmpeg: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`FFmpeg stderr: ${stderr}`);
            return;
        }
        console.log(`FFmpeg stdout: ${stdout}`);
    });

    // Wait for the FFmpeg process to finish
    await new Promise(resolve => result.on('close', resolve));

    // Read and save the generated frames
    const frameFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.jpg'));
    if (frameFiles.length === 0) {
        throw new Error('No frames found for reassembly.');
    }

    const MEMFS = frameFiles.map(file => ({
        name: file,
        data: new Uint8Array(fs.readFileSync(path.join(outputDir, file))),
    }));
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

async function reassembleVideo(frameDir, outputDir) {
    const frameFiles = fs.readdirSync(frameDir).filter(file => file.endsWith('.jpg'));
    if (frameFiles.length === 0) {
        throw new Error('No frames found for reassembly.');
    }

    const MEMFS = frameFiles.map(file => ({
        name: file,
        data: new Uint8Array(fs.readFileSync(path.join(frameDir, file))),
    }));

    // Dynamically generate the output filename if not provided
    let outputFilename = 'redacted_video.mp4';
    if (outputDir.endsWith('/')) {
        // If the output directory ends with '/', assume it's meant to be a directory
        outputFilename = 'output.mp4'; // Default filename if directory is provided
    }

    // Construct the full output path
    const outputPath = path.join(outputDir, outputFilename);

    // Ensure the output directory exists
    const outputDirPath = path.dirname(outputPath);
    if (!fs.existsSync(outputDirPath)) {
        fs.mkdirSync(outputDirPath, { recursive: true });
    }

    const result = ffmpeg({
        MEMFS: MEMFS,
        arguments: ['-framerate', '1', '-i', 'frame_%03d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath],
    });

    const output = result.MEMFS.find(file => file.name === outputFilename);
    if (output) {
        fs.writeFileSync(outputPath, Buffer.from(output.data));
    } else {
        console.error(result.stderr);
        throw new Error('Output video file not found.');
    }
}


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
