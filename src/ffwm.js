import FFmpegWorker from './ffmpeg.js';

export default class FfWM {
  transmuxer
  coreURL
  wasmURL
  bufferSizeSec
  bufferRefillSec
  logCallbacks = []

  mediaSource
  ffmpegWorker
  loadedMediaMetadata
  videoSourceBuffer
  updatingVideoTime
  nextTask

  /**
   * 
   * @param {string} coreURL - /ffmpeg-core.js
   * @param {string} wasmURL - /ffmpeg-core.wasm
   * @param {string} nuxjsURL - /mux.min.js
   * @param {number} bufferSizeSec - 10
   * @param {number} bufferRefillSec - 5
   */
  constructor(coreURL, wasmURL, nuxjsURL, bufferSizeSec, bufferRefillSec) {
    if (!window.MediaSource) {
      throw new Error("Media Source Extensions are not supported by this browser.")
    }
    if (bufferRefillSec > bufferSizeSec) {
      throw new Error("Buffer refill time must be bigger than buffer size")
    }
    if (nuxjsURL) {
      let self = this
      let s = document.createElement('script')
      s.src = nuxjsURL
      document.head.appendChild(s)
      s.onload = function () {
        setTimeout(function () {
          // eslint-disable-next-line
          self.transmuxer = new muxjs.mp4.Transmuxer()
        }, 0);
      }
    } else {
      // eslint-disable-next-line
      this.transmuxer = new muxjs.mp4.Transmuxer()
    }
    this.bufferSizeSec = bufferSizeSec
    this.bufferRefillSec = bufferRefillSec
    this.coreURL = coreURL
    this.wasmURL = wasmURL
    this.mediaSource = new MediaSource()
    this.ffmpegWorker = new FFmpegWorker()
  }

  /**
   * Load media from File object
   * 
   * @param {File} file 
   * @returns {object} - {"src": "blob:http://...",
      "videoStreams": [{
        "id": "0:0",
        "lang": "eng",
        "formatDescription": "h264 (High), yuv420p(tv, bt709, progressive), 1920x800 ..."
      }],
      "audioStreams": [{
          "id": "0:1",
          "lang": "eng",
          "formatDescription": "eac3, 48000 Hz, 5.1(side), fltp, 768 kb/s"
      }]}
   */
  async loadMedia(file) {
    if (this.ffmpegWorker.isLoaded()) {
      this.clean()
    }
    this.log("Starting ffmpeg worker")
    await this.ffmpegWorker.load(this.coreURL, this.wasmURL)
    this.log("Loaded ffmpeg worker")
    await this.ffmpegWorker.setInputFile(file)
    this.loadedMediaMetadata = await this.ffmpegWorker.getMetadata()
    this.logMetadata()
    let src = URL.createObjectURL(this.mediaSource)
    this.mediaSource.addEventListener('sourceopen', () => {
      URL.revokeObjectURL(src)
    }, { once: true })
    return {
      src,
      videoStreams: this.loadedMediaMetadata.videoStreams,
      audioStreams: this.loadedMediaMetadata.audioStreams
    }
  }

  /**
   * Start playback, replenish the buffer by bufferSizeSec
   * Need to run onTimeUpdate to refill buffer
   * 
   * @param {string} videoStreamId like 0:0
   * @param {string} audioStreamId like 0:1
   */
  async start(videoStreamId, audioStreamId) {
    let attempt = 1
    const readyStatePromise = () => new Promise((resolve, reject) => {
      if (this.mediaSource.readyState == "open") {
        resolve("open");
      } else if (this.mediaSource.readyState == "closed" && attempt < 3) {
        attempt++
        this.log('wait mediaSource readyState == open')
        setTimeout(() => readyStatePromise().then(resolve).catch(reject), 100)
      } else {
        reject("media source is not in ready state")
      }
    })
    await readyStatePromise()
    let i = this.loadedMediaMetadata.audioStreams.map((s) => s.id).indexOf(audioStreamId)
    if (i < 0 && audioStreamId) {
      throw Error("id not found in audio streams")
    }
    i = this.loadedMediaMetadata.videoStreams.map((s) => s.id).indexOf(videoStreamId)
    if (i < 0) {
      throw Error("id not found in video streams")
    }
    let containers = this.ffmpegWorker.setStreams(videoStreamId, audioStreamId)
    this.mediaSource.duration = this.loadedMediaMetadata.durationSeconds
    this.addSourceBuffers(containers.videoContainer)
    await this.onTimeUpdate(0)
  }

  /**
   * Refill buffer by bufferSizeSec if the remaining buffer is less than bufferRefillSec
   * 
   * @param {Number} time - current playback time
   */
  async onTimeUpdate(time) {
    let state = this.ffmpegWorker.ffmpegState
    if (state == 1 || state == 2) return
    let update = (t) => {
      return async () => {
        const nextChunkTime = this.getFirstUnbuffered(this.videoSourceBuffer, t)
        if (nextChunkTime - t < this.bufferRefillSec) {
          await this.loadChunk(
            nextChunkTime == 0 ? nextChunkTime : nextChunkTime - 0.1,
            this.bufferSizeSec + 0.1
          )
        }
      }
    }
    if (this.updatingVideoTime) {
      if (!(this.updatingVideoTime <= time && time <= this.updatingVideoTime + this.bufferSizeSec)) {
        this.nextTask = update(time)
      }
      return
    }
    await update(time)()
  }

  setAudioStream(id) {
    let i = this.loadedMediaMetadata.audioStreams.map((s) => s.id).indexOf(id)
    if (i < 0) {
      throw Error("id not found in audio streams")
    }
    this.ffmpegWorker.setStreams(false, id)
  }

  addLogCallback(cb) {
    this.logCallbacks.push(cb);
  }

  log(logEntry) {
    //console.log(logEntry);
    this.logCallbacks.forEach(cb => cb(logEntry));
  }

  logMetadata() {
    this.log("Parsed metadata:")
    this.log(`  Duration: ${this.loadedMediaMetadata.durationSeconds}s`)
    this.loadedMediaMetadata.videoStreams.forEach(s => {
      this.log(`  Video stream ${s.id}(${s.lang || "n/a"}): ${s.formatDescription}`)
    })
    this.loadedMediaMetadata.audioStreams.forEach(s => {
      this.log(`  Audio stream ${s.id}(${s.lang || "n/a"}): ${s.formatDescription}`)
    })
  }

  clean() {
    this.loadedMediaMetadata = undefined
    this.videoSourceBuffer = undefined
    this.updatingVideoTime = undefined
    this.nextTask = undefined
    this.mediaSource = new MediaSource()
    this.ffmpegWorker.terminate()
    this.ffmpegWorker = new FFmpegWorker()
  }

  getFirstUnbuffered(sourceBuffer, time) {
    if (!sourceBuffer) {
      return 0
    }
    let intersectingRangeEnd = undefined
    const bufferedRanges = sourceBuffer.buffered
    for (let j = 0; j < bufferedRanges.length; j++) {
      const start = bufferedRanges.start(j)
      const end = bufferedRanges.end(j)
      //this.log(j + ': ' + time + ' | ' + start + ' | ' + end)
      if (start <= time && time <= end) {
        intersectingRangeEnd = end
        break
      }
    }
    if (intersectingRangeEnd === undefined) {
      return time
    }
    return intersectingRangeEnd
  }

  addSourceBuffers(chunk) {
    if (chunk != null) {
      this.videoSourceBuffer = this.mediaSource.addSourceBuffer(chunk.mime)
    }
  }

  async loadChunk(start, len) {
    if (this.updatingVideoTime) {
      throw Error("new loadChunk request while buizy")
    }
    this.updatingVideoTime = start
    this.log(`Remuxing Video with time range [${start} - ${start + len}]`)
    const chunk = await this.ffmpegWorker.remuxer(start, len)
    const cb = async (s) => {
      const sizeMB = (s.length / (1 << 20)).toFixed(3)
      this.log(`Added remuxed Video with size ${sizeMB} MB to SourceBuffer`)
      this.updatingVideoTime = undefined
      if (this.nextTask) {
        await this.nextTask()
        this.nextTask = undefined
      }
    }
    if (chunk) {
      this.videoSourceBuffer.addEventListener("updateend", () => cb(chunk), { once: true })
      if (start == 0) {
        this.appendFirstSegment(chunk, this.videoSourceBuffer)
      } else {
        this.appendNextSegment(chunk, this.videoSourceBuffer)
      }
    }
  }

  appendFirstSegment(arrayBuff, sourceBuffer) {
    this.transmuxer.on('data', (segment) => {
      let data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
      data.set(segment.initSegment, 0);
      data.set(segment.data, segment.initSegment.byteLength);
      //this.log(muxjs.mp4.tools.inspect(data));
      sourceBuffer.appendBuffer(data);
      // reset the 'data' event listener to just append (moof/mdat) boxes to the Source Buffer
      this.transmuxer.off('data');
    })
    this.transmuxer.push(new Uint8Array(arrayBuff));
    this.transmuxer.flush();
  }

  appendNextSegment(arrayBuff, sourceBuffer) {
    this.transmuxer.on('data', (segment) => {
      sourceBuffer.appendBuffer(new Uint8Array(segment.data));
      this.transmuxer.off('data');
    })
    this.transmuxer.push(new Uint8Array(arrayBuff));
    this.transmuxer.flush();
  }
}
