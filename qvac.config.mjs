// QVAC bundle config: only the LLM engine ships in the app. Without this the
// Expo plugin bundles every built-in engine (speech, TTS, music…), which
// bloats the APK for features MyMonies doesn't use.
export default {
  plugins: ['@qvac/sdk/llamacpp-completion/plugin'],
  loggerLevel: 'info',
  // Advisory on a 3.6 GB phone: log the fitter's verdict, still try the load.
  modelFitPolicy: 'log',
  // The first worker start is slow on a budget phone (and on a busy laptop).
  rpcInitTimeoutMs: 120000,
};
