import Ffwm from '../src/ffwm.js';
const transcode = async ({ target: { files } }) => {
    ffwm.loadMedia(files[0]).then((data) => {
        let audioStreams = data.audioStreams
        selectAudioStream(audioStreams)
        video.src = data.src
        ffwm.start(data.videoStreams[0]?.id, audioStreams[0]?.id).then(() => {
            video.play()
        })
    })
}
const selectAudioStream = (audioStreams) => {
    let select = document.getElementById('select');
    for (var i in audioStreams) {
        var opt = document.createElement('option');
        opt.value = audioStreams[i].id
        opt.innerHTML = audioStreams[i].lang + "(" + audioStreams[i].formatDescription + ")";
        select.appendChild(opt);
    }
    select.addEventListener('change', function (e) {
        ffwm.setAudioStream(e.target.value)
    })
}

const elm = document.getElementById('uploader');
elm.addEventListener('change', transcode);
const video = document.getElementById('output-video')
const ffwm = new Ffwm(
    "/assets/core/ffmpeg-core.js",
    "/assets/core/ffmpeg-core.wasm",
    "/assets/mux.min.js",
    11.4, 8
)
video.addEventListener("timeupdate", () => {
    if (video.currentTime != 0) {
        ffwm.onTimeUpdate(video.currentTime)
    }
})