/** NativeWind consumes the stylesheet through Metro; TS only needs it to resolve. */
declare module '*.css';

/** Drizzle migrations are inlined by babel-plugin-inline-import. */
declare module '*.sql' {
  const content: string;
  export default content;
}
