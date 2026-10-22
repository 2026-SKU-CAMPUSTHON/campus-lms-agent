/** Document/media/PDF workers do not need database or model credentials. */
export function workerEnvironment():NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|_URL$|_DSN$|BOOTSTRAP_)/i.test(key)));
}
