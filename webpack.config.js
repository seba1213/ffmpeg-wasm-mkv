const path = require("path");

module.exports = {
  resolve: {
    extensions: ['.ts', '.js'],
  },
  entry: {
    bundle: "./src/index.js",
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "/dist/"
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{
          loader: "ts-loader"
        }],
        exclude: /node_modules/
      },
      {
        test: /src\/assets\//,
        type: 'asset/resource'
      }
    ]
  },
  devtool: "source-map",
  devServer: {
    hot: false,
    liveReload: false,
    // Allow use of SharedArrayBuffer, needed by emscripten threads
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    static: {
      directory: path.join(__dirname, "public"),
    },
    compress: true,
    client: {
      overlay: {
        errors: true,
        warnings: false
      }
    },
    port: 9000
  }
};
