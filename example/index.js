import Ffwm from '../src/ffwm.js';
const transcode = async ({ target: { files } }) => {
    ffwm.loadMedia(files[0]).then((data) => {
        let audioStreams = data.audioStreams
        selectAudioStream(audioStreams)
        video.src = data.src
        video.addEventListener("timeupdate", () => {
            if (video.currentTime != 0) {
                ffwm.onTimeUpdate(video.currentTime)
            }
        }, { once: true })
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
    }, { once: true })
}

const elm = document.getElementById('uploader');
elm.addEventListener('change', transcode);
const video = document.getElementById('output-video')
const ffwm = new Ffwm(
    "/assets/ffmpeg-core.js",
    "/assets/ffmpeg-core.wasm",
    "/assets/mux.min.js",
    10, 5
)

