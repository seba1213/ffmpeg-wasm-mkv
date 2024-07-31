import { fromEventPattern, firstValueFrom } from 'rxjs'
import { takeWhile, toArray } from 'rxjs/operators'
import { FFmpeg } from '@ffmpeg/ffmpeg'

var FFmpegState = {
  Uninitialized: 1,
  Initializing: 2,
  Idle: 3,
  Busy: 4
}

export default class FFmpegWorker {

  streamRegex = /\s*Stream #(?<id>\d+:\d+)\(?(?<lang>.*?)\)?: (?<type>\w+): (?<formatDescription>.*)/;
  durationRegex = /Duration: (\d+?):(\d{2}):(.+?),/;
  outputDir = "/output";

  videoStreamContainer
  audioStreamContainer
  audioStream
  videoStream
  file
  ffmpegCore
  ffmpegLogObservable
  inputPath
  inputMetadata
  ffmpegState = FFmpegState.Uninitialized;

  videoCompatibleContainer(format) {
    if (format.startsWith("h264")) {
      return {
        convert: false,
        mime: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"'
      };
    }
    throw new Error("Unsupported video format description: " + format);
  }

  audioCompatibleContainer(format) {
    if (format.startsWith("flac") || format.startsWith("mp3")
      || format.startsWith("vorbis") || format.startsWith("opus")
      || format.startsWith("ac3") || format.startsWith("eac3")) {
      return {
        convert: true,
        codec: "aac",
        mime: 'audio/mp4; codecs="mp4a.40.2"' // AAC-LC
      }
    } else if (format.startsWith("aac")) {
      return {
        convert: false,
        mime: 'audio/mp4; codecs="mp4a.40.2"' // AAC-LC
      };
    }
    throw new Error("Unsupported audio format description: " + format);
  }


  assertState(expected) {
    if (this.ffmpegState != expected) {
      throw new Error(`Expected state ${expected} but current state is ${this.ffmpegState}`);
    }
  }

  assertInput() {
    if (typeof this.inputPath === "undefined") {
      throw new Error("No file set as input with setInputFile");
    }
  }

  isLoaded() {
    return !(this.ffmpegState == FFmpegState.Uninitialized);
  }

  async load(coreURL, wasmURL) {
    this.assertState(FFmpegState.Uninitialized);
    this.ffmpegState = FFmpegState.Initializing;

    const handlers = [];

    const addLogHandler = (handler) => {
      handlers.push(handler);
    };
    const removeLogHandler = (handler) => {
      handlers.splice(handlers.indexOf(handler), 1);
    };
    this.ffmpegLogObservable = fromEventPattern(addLogHandler, removeLogHandler);

    this.ffmpegCore = new FFmpeg();

    this.ffmpegCore.on('log', ({ message: msg }) => {
      //console.log(msg);
      if (msg === "FFMPEG_END" || msg === "Aborted()") {
        this.ffmpegState = FFmpegState.Idle;
      }
      for (const handler of handlers) {
        handler(msg);
      }
    })

    await this.ffmpegCore.load({ coreURL, wasmURL })
    this.ffmpegState = FFmpegState.Idle;
  }

  mountFile() {
    this.assertState(FFmpegState.Idle);
    const inputDir = "/input"
    this.ffmpegCore.createDir(inputDir)
    this.ffmpegCore.createDir(this.outputDir)
    this.ffmpegCore.mount("WORKERFS", { files: [this.file] }, inputDir)
    this.inputPath = inputDir + "/" + this.file.name
  }

  async setInputFile(file) {
    this.file = file
    this.mountFile()

    /* Get metadata by invoking ffmpeg -i */

    const logEntriesPromise = firstValueFrom(
      this.ffmpegLogObservable.pipe(
        takeWhile(line => {
          return line !== "FFMPEG_END" && line !== "Aborted()"
        }),
        toArray()
      )
    );
    this.workerExec(["-i", this.inputPath]);
    const logEntries = await logEntriesPromise;

    this.inputMetadata = {
      durationSeconds: undefined,
      audioStreams: [],
      videoStreams: []
    };
    for (const line of logEntries) {
      const durationMatch = line.match(this.durationRegex);
      if (durationMatch) {
        this.inputMetadata.durationSeconds = parseFloat(
          durationMatch[3]) + 60 * parseInt(durationMatch[2]) + 60 * 60 * parseInt(durationMatch[1]);
      }

      const streamMatch = this.streamRegex.exec(line);
      if (streamMatch) {
        const { id, lang, type, formatDescription } = streamMatch.groups;
        const stream = {
          id,
          lang,
          formatDescription
        };
        switch (type) {
          case "Audio":
            this.inputMetadata.audioStreams.push(stream);
            break;
          case "Video":
            this.inputMetadata.videoStreams.push(stream);
            break;
          default:
          //console.warn("Ignoring non-audio/video stream", stream);
        }
      }
    }
    //console.log(this.inputMetadata);
  }

  async getMetadata() {
    this.assertInput()
    return this.inputMetadata
  }

  setStreams(videoStreamId, audioStreamId) {
    if (videoStreamId) {
      const videoStreams = this.inputMetadata.videoStreams.filter(s => s.id == videoStreamId)
      if (videoStreams.length == 0) {
        throw Error(`No video stream found with id ${videoStreamId}`)
      }
      this.videoStream = videoStreams[0]
      this.videoStreamContainer = this.videoCompatibleContainer(this.videoStream.formatDescription)
    }
    if (audioStreamId) {
      const audioStreams = this.inputMetadata.audioStreams.filter(s => s.id == audioStreamId)
      if (audioStreams.length == 0) {
        throw Error(`No audio stream found with id ${audioStreamId}`)
      }
      this.audioStream = audioStreams[0]
      this.audioStreamContainer = this.audioCompatibleContainer(this.audioStream.formatDescription)
    }
    return {
      audioContainer: this.audioStreamContainer ? this.audioStreamContainer : [],
      videoContainer: this.videoStreamContainer ? this.videoStreamContainer : []
    }
  }

  async remuxer(seekOffsetSeconds = 0.0, durationSeconds) {
    if (!this.videoStream) {
      throw Error("Init streams first")
    }
    this.assertInput()
    this.assertState(FFmpegState.Idle)
    this.ffmpegState = FFmpegState.Busy

    let args = [
      "-hide_banner",
      "-ss", seekOffsetSeconds.toString(), // Seek input file
      ...(typeof durationSeconds === "undefined" ? [] : ["-t", durationSeconds.toString()]), // Duration of chunk
      "-copyts",
      "-start_at_zero",
      "-i", this.inputPath, // Input file
    ]
    if (this.videoStreamContainer) {
      args = args.concat(this.videoArgs())
    }
    if (this.audioStreamContainer) {
      args = args.concat(this.audioArgs())
    }
    args = args.concat([
      "-f", "mpegts",
      "-muxdelay", "0",
      "-muxpreload", "0",
      `${this.outputDir}/video`,
    ])

    await this.workerExec(args)

    var videoChunk = await this.ffmpegCore.readFile(`${this.outputDir}/video`)
    this.ffmpegCore.deleteFile(`${this.outputDir}/video`)
    this.ffmpegState = FFmpegState.Idle
    return videoChunk
  }

  videoArgs() {
    return [
      "-map", this.videoStream.id,
      "-vcodec", "copy",
    ]
  }

  audioArgs() {
    let args = [
      "-map", this.audioStream.id,
    ]
    if (this.audioStreamContainer.convert) {
      args = args.concat([
        "-strict", "-2",
        "-ac", "2",
        "-ar", "48000",
        "-b:a", "192k",
        "-acodec", this.audioStreamContainer.codec
      ])
    } else {
      args = args.concat([
        "-acodec", "copy"
      ])
    }
    return args
  }

  async workerExec(args) {
    //console.log("Running ffmpeg", args)
    try {
      return await this.ffmpegCore.exec(args)
    } catch (e) {
      console.error("wasm error: '" + e + "' rerun...")
      this.ffmpegCore.terminate()
      this.ffmpegState = FFmpegState.Uninitialized
      this.ffmpegLogObservable = undefined
      await this.load()
      this.mountFile()
      return await this.ffmpegCore.exec(args)
    }
  }

  terminate() {
    this.ffmpegCore?.terminate()
  }
}
