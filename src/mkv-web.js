import FFmpegWorker from './ffmpeg.js';

export default class MKVWeb {
  videoElement
  mediaSource
  ffmpegWorker
  loadedMediaMetadata
  videoSourceBuffer
  updatingVideoTime
  logCallbacks = []
  transmuxer

  constructor(video) {
    if (!window.MediaSource) {
      throw new Error("Media Source Extensions are not supported by this browser.")
    }
    this.transmuxer = new muxjs.mp4.Transmuxer();
    this.videoElement = video
    this.mediaSource = new MediaSource()
    this.videoElement.src = URL.createObjectURL(this.mediaSource)
    this.mediaSource.addEventListener('sourceopen', () => {
      URL.revokeObjectURL(video.src)
    }, { once: true })
    this.ffmpegWorker = new FFmpegWorker()
  }

  addLogCallback(cb) {
    this.logCallbacks.push(cb);
  }

  log(logEntry) {
    //console.log(logEntry);
    this.logCallbacks.forEach(cb => cb(logEntry));
  }

  async loadMedia(file) {
    if (!this.ffmpegWorker.isLoaded()) {
      this.log("Starting ffmpeg worker")
      await this.ffmpegWorker.load()
      this.log("Loaded ffmpeg worker")
    }

    const readyStatePromise = () => new Promise((resolve, reject) => {
      if (this.mediaSource.readyState == "open") {
        resolve("open");
      } else if (this.mediaSource.readyState == "closed") {
        this.log('wait mediaSource readyState == open')
        setTimeout(() => readyStatePromise().then(resolve).catch(reject), 500)
      } else {
        reject(this.mediaSource.readyState)
      }
    })
    await readyStatePromise()

    await this.ffmpegWorker.setInputFile(file)
    this.loadedMediaMetadata = await this.ffmpegWorker.getMetadata()
    this.logMetadata()
    this.mediaSource.duration = this.loadedMediaMetadata.durationSeconds
    var containers = this.ffmpegWorker.setStreams(
      this.loadedMediaMetadata.videoStreams[0]?.id, this.loadedMediaMetadata.audioStreams[0]?.id
    )
    this.addSourceBuffers(containers.videoContainer)
    this.videoElement.addEventListener("timeupdate", () => this.onTimeUpdate())
    this.onTimeUpdate()
  }

  setAudioStream(id) {
    let i = this.loadedMediaMetadata.audioStreams.map((s) => s.id).indexOf(id)
    if (i < 0) {
      throw Error("id not found in audio streams")
    }
    this.ffmpegWorker.setStreams(false, id)
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

  audioStreams() {
    if (this.loadedMediaMetadata) {
      return this.loadedMediaMetadata.audioStreams
    } else {
      throw Error("loadMedia first")
    }
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
      this.log(j + ': ' + time + ' | ' + start + ' | ' + end)
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

  async onTimeUpdate() {
    if (this.ffmpegWorker.ffmpegState == 4 || this.updatingVideoTime) return

    const time = this.videoElement.currentTime
    const nextChunkTime = this.getFirstUnbuffered(this.videoSourceBuffer, time)

    if (nextChunkTime - time < 5.0) {
      await this.loadChunk(nextChunkTime == 0 ? nextChunkTime : nextChunkTime - 0.1, 10.1)
    }
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

    const cb = (s) => {
      const sizeMB = (s.length / (1 << 20)).toFixed(3)
      this.log(`Added remuxed Video with size ${sizeMB} MB to SourceBuffer`)
      this.updatingVideoTime = undefined
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
      this.log(muxjs.mp4.tools.inspect(data));
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
