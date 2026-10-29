// Entry for bare-link only: native addons the WDK worklet loads lazily,
// which bare-link misses when walking the worklet's module graph (found when
// the wallet aborted with "Cannot load addon libbare-broadcast-channel").
require('bare-broadcast-channel')
