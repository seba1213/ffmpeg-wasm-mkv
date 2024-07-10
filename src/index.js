import MKVWeb from './mkv-web.js';
const transcode = async ({ target: { files } }) => {
    mkvWeb.loadMedia(files[0]).then(() => {
        let a = mkvWeb.audioStreams()
        let select = document.getElementById('select');
        for (var i in a) {
            var opt = document.createElement('option');
            opt.value = a[i].id
            opt.innerHTML = a[i].lang + "(" + a[i].formatDescription + ")";
            select.appendChild(opt);
        }
        select.addEventListener('change', function (e) {
            mkvWeb.setAudioStream(e.target.value)
        })
        video.play()
    })
}
const elm = document.getElementById('uploader');
elm.addEventListener('change', transcode);
const video = document.getElementById('output-video')
const mkvWeb = new MKVWeb(video);

