# ffmpeg-wasm-mkv
Playing mkv (Matroska) and other file formats with video in h264 format and any audio format in the browser

## Project description
Modern web browsers only support the WebM container format that is based on Matroska, but limited to royalty-free codecs.
Even when the MKV file contains media encoded by a codec that the browser is able to decode, most browsers are unable to play media in such a container.
This project copies video streams as they are in the source container and converts the audio stream in a browser-friendly format (converts to aac stereo)
This is achieved by remuxing media segments with ffmpeg compiled to webassembly (thanks to [the ffmpeg.wasm project](https://github.com/ilian/ffmpeg.wasm-core)) using [web workers](https://html.spec.whatwg.org/multipage/workers.html).

## Installation

Install the package from npm:

npm install ffmpeg-wasm-mkv
# or
yarn add ffmpeg-wasm-mkv
# or
pnpm add ffmpeg-wasm-mkv

## Usage
```js
import Ffwm from 'ffmpeg-wasm-mkv';

const ffwm = new Ffwm(
  '/assets/core/ffmpeg-core.js',
  '/assets/core/ffmpeg-core.wasm',
  '/assets/mux.min.js',
  11.4, // buffer size in seconds
  8     // refill threshold in seconds
);

// `file` is a File from <input type="file">
const { src, videoStreams, audioStreams } = await ffwm.loadMedia(file);

const video = document.getElementById('output-video');
video.src = src;

await ffwm.start(videoStreams[0]?.id, audioStreams[0]?.id);
video.play();
```

## Release notes
Tested in Chrome, mobile Chrome and Firefox, will work in all modern browsers which support webassembly and [Media Source Extensions](https://www.w3.org/TR/media-source-2/)
Problems were noticed when playing videos compressed with some codecs. The list is still being finalized.
To see the logs uncomment:
```js
log(logEntry) {
  //console.log(logEntry);
  this.logCallbacks.forEach(cb => cb(logEntry));
}
```
```js
this.ffmpegCore.on('log', ({ message: msg }) => {
  //console.log(msg);
```

The project was implemented based on the [mkv-web](https://github.com/ilian/mkv-web/tree/master) project
