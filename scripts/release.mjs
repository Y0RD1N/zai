import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repository = 'Y0RD1N/zai'
export function releaseVersion(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`) throw new Error('La etiqueta debe coincidir exactamente con la versión de package.json (vX.Y.Z).')
  return version
}
export function installers(version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versión de distribución inválida.')
  const targets = { Linux: { x64: ['AppImage', 'rpm'] }, Windows: { x64: ['exe'] }, macOS: { x64: ['dmg'], arm64: ['dmg'] } }
  const extensions = targets[platform]?.[arch]
  if (!extensions) throw new Error('Plataforma o arquitectura de distribución no admitida.')
  return extensions.map((ext) => `Zai-${version}-${platform}-${arch}${platform === 'Windows' ? '-Setup' : ''}.${ext}`)
}
const variants = [['Linux', 'x64'], ['Windows', 'x64'], ['macOS', 'x64'], ['macOS', 'arm64']]
const checksumName = (platform, arch) => `SHA256SUMS-${platform}-${arch}.txt`
async function digest(file) {
  const stat = await lstat(file)
  if (!stat.isFile() || !stat.size) throw new Error(`Instalador ausente, vacío o no regular: ${path.basename(file)}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function stage(version, platform, arch, source = 'release', destination = 'release/installers') {
  const files = installers(version, platform, arch), sums = []
  await mkdir(destination, { recursive: true })
  for (const name of files) {
    const sha = await digest(path.join(source, name))
    await copyFile(path.join(source, name), path.join(destination, name))
    sums.push(`${sha}  ${name}`)
  }
  await writeFile(path.join(destination, checksumName(platform, arch)), sums.join('\n') + '\n')
}
export async function verifyAssets(version, directory) {
  const expected = variants.flatMap(([platform, arch]) => [...installers(version, platform, arch), checksumName(platform, arch)])
  const all = await readdir(directory)
  if (all.includes('SHA256SUMS.txt') && !(await lstat(path.join(directory, 'SHA256SUMS.txt'))).isFile()) throw new Error('La suma consolidada no es un archivo regular.')
  const actual = all.filter((name) => name !== 'SHA256SUMS.txt')
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name))) throw new Error('Los archivos descargados no coinciden con las cuatro distribuciones esperadas.')
  const verified = []
  for (const [platform, arch] of variants) {
    const names = installers(version, platform, arch)
    const lines = (await readFile(path.join(directory, checksumName(platform, arch)), 'utf8')).trim().split('\n')
    if (lines.length !== names.length) throw new Error('Lista de sumas incompleta.')
    for (const [index, name] of names.entries()) {
      const sha = await digest(path.join(directory, name))
      if (lines[index] !== `${sha}  ${name}`) throw new Error(`La suma SHA-256 no coincide: ${name}`)
      verified.push(`${sha}  ${name}`)
    }
  }
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), verified.sort().join('\n') + '\n')
  return [...variants.flatMap(([platform, arch]) => installers(version, platform, arch)), 'SHA256SUMS.txt'].map((name) => path.join(directory, name))
}
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function main() {
  const [command, platform, arch] = process.argv.slice(2)
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  if (command === 'stage') { await stage(version, platform, arch); return }
  const tag = process.env.RELEASE_TAG || ''
  releaseVersion(tag, version)
  const commit = run('git', ['rev-parse', 'HEAD'])
  if (run('git', ['rev-parse', `${tag}^{commit}`]) !== commit) throw new Error('La etiqueta no apunta al código que se está comprobando.')
  run('git', ['merge-base', '--is-ancestor', commit, 'origin/main'])
  if (command === 'verify') {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\ncommit=${commit}\nversion=${version}\n`)
    console.log(`Distribución verificada: ${tag} · ${commit}`); return
  }
  if (command !== 'publish') throw new Error('Comando de distribución desconocido.')
  if (process.env.GITHUB_REPOSITORY !== repository || process.env.GITHUB_ACTOR_ID !== '173011369') throw new Error('Solo el propietario puede publicar en el repositorio oficial.')
  const files = await verifyAssets(version, 'release-assets')
  const marker = `<!-- zai-release:${commit} -->`
  let existing
  // Only a 404 means there is no release. Authentication or service failures must stop publication.
  try { existing = JSON.parse(run('gh', ['api', `repos/${repository}/releases/tags/${tag}`])) }
  catch (error) { if (!String(error.stderr).includes('HTTP 404') && !String(error.stdout).includes('"status":"404"')) throw error }
  if (existing && (!existing.draft || !existing.body?.includes(marker))) throw new Error('Ya existe una publicación para esta etiqueta; no se sobrescribirá.')
  if (!existing) {
    const notes = path.join(tmpdir(), `zai-${tag}-release-notes.md`)
    await writeFile(notes, `Zai ${version}: tu pizarra para agentes, proyectos e ideas.\n\nInstaladores de Linux (AppImage y RPM), Windows x64 y macOS Intel / Apple Silicon.\n\nEsta distribución no tiene certificados de editor de Apple o Microsoft. macOS usa firma ad hoc y no está notarizada; el sistema puede solicitar autorización manual.\n\nComprueba los archivos con SHA256SUMS.txt.\n\nCódigo fuente: ${commit}\n\n${marker}\n`)
    run('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', `Zai ${version}`, '--notes-file', notes])
  }
  run('gh', ['release', 'upload', tag, '--repo', repository, ...files, ...(existing ? ['--clobber'] : [])])
  // The repository makes releases immutable when published. Upload and verify everything first.
  const uploaded = JSON.parse(run('gh', ['api', `repos/${repository}/releases/tags/${tag}`]))
  if (uploaded.assets.length !== files.length) throw new Error('La publicación no contiene todos los archivos esperados.')
  for (const file of files) {
    const asset = uploaded.assets.find((asset) => asset.name === path.basename(file))
    const sha = await digest(file)
    if (!asset || asset.digest !== `sha256:${sha}` || asset.size !== (await lstat(file)).size) throw new Error(`GitHub no confirmó la integridad de ${path.basename(file)}.`)
  }
  run('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest'])
  console.log(`Publicado: https://github.com/${repository}/releases/tag/${tag}`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
