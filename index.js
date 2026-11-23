// CommonJS require order matters — ES imports are hoisted and would load
// expo-router (which enables native screens) before enableScreens(false).
// Keep screens disabled: native Screen surfaces previously contributed to
// opaque overlays on this Pixel 7 development build.
require('react-native-screens').enableScreens(false);
require('expo-router/entry');
