module.exports = function (api) {
  api.cache(true);
  return {
    // Enables react-native-worklets / reanimated transforms via babel-preset-expo.
    presets: ['babel-preset-expo'],
  };
};
