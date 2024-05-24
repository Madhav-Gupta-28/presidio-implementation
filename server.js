const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg'); // Import fluent-ffmpeg

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
    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Construct the absolute path for the output file
    const absoluteOutputDir = path.resolve(__dirname, outputDir); // Resolve to an absolute path
    const outputFile = path.join(absoluteOutputDir, 'redacted_video.mp4');

    // Get a list of all redacted frame files
    const frameFiles = fs.readdirSync(frameDir).filter(file => file.endsWith('.jpg'));

    // Create a write stream for the output file
    const writeStream = fs.createWriteStream(outputFile);

    // Iterate over each redacted frame file and pipe it into the output video
    frameFiles.forEach(async (file) => {
        const filePath = path.join(frameDir, file);
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(writeStream);
    });

    // Listen for the 'finish' event on the write stream to know when the video is assembled
    writeStream.on('finish', () => {
        console.log('Video reassembled successfully');
    });

    // Listen for the 'error' event on the write stream to catch any errors during assembly
    writeStream.on('error', (err) => {
        console.error('Failed to reassemble video:', err.message);
    });
}



app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
