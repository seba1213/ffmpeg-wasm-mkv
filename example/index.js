import Ffwm from '../src/ffwm.js';

const elm = document.getElementById('uploader');
const video = document.getElementById('output-video')
const mtToggle = document.getElementById('mt-toggle')

let ffwm = null

const createFfwm = () => {
    const mt = mtToggle.checked
    const coreDir = mt ? "/assets/core-mt" : "/assets/core"
    return new Ffwm(
        `${coreDir}/ffmpeg-core.js`,
        `${coreDir}/ffmpeg-core.wasm`,
        "/assets/mux.min.js",
        11.4, 8,
        mt ? `${coreDir}/ffmpeg-core.worker.js` : null
    )
}

const selectAudioStream = (audioStreams) => {
    let select = document.getElementById('select');
    select.innerHTML = ''
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

const transcode = async ({ target: { files } }) => {
    ffwm = createFfwm()
    ffwm.loadMedia(files[0]).then((data) => {
        let audioStreams = data.audioStreams
        selectAudioStream(audioStreams)
        video.src = data.src
        ffwm.start(data.videoStreams[0]?.id, audioStreams[0]?.id).then(() => {
            video.play()
        })
    })
}

elm.addEventListener('change', transcode);

video.addEventListener("timeupdate", () => {
    if (video.currentTime != 0 && ffwm) {
        ffwm.onTimeUpdate(video.currentTime)
    }
})