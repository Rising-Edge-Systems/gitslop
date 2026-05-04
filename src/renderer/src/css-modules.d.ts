declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

// Vite's ?worker suffix imports a file as a Web Worker constructor.
declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
