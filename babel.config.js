module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      // Lets Drizzle migrations be imported as modules (.sql -> string).
      ['inline-import', { extensions: ['.sql'] }],
      // Must stay last. Reanimated 4 moved its Babel plugin into react-native-worklets.
      'react-native-worklets/plugin',
    ],
  };
};
