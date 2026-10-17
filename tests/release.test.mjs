import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findRelease, installers, releaseVersion, stage, verifyAssets } from '../scripts/release.mjs'
const variants = [['Linux', 'x64'], ['Windows', 'x64'], ['macOS', 'x64'], ['macOS', 'arm64']]
test('la publicación recupera borradores paginados y no oculta errores de GitHub', () => {
  const draft = { id: 42, tag_name: 'v0.4.1', draft: true }
  const invoke = (program, args) => {
    assert.equal(program, 'gh')
    assert.deepEqual(args, ['api', 'repos/Y0RD1N/zai/releases?per_page=100', '--paginate', '--slurp'])
    return JSON.stringify([[{ tag_name: 'v0.4.2', draft: false }], [draft]])
  }
  assert.deepEqual(findRelease('v0.4.1', invoke), draft)
  assert.equal(findRelease('v0.3.0', invoke), undefined)
  assert.throws(() => findRelease('v0.4.1', () => { throw new Error('HTTP 403') }), /HTTP 403/)
})
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zai-release-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'build'), output = path.join(directory, 'artifacts')
  await mkdir(source)
  for (const [platform, arch] of variants) {
    for (const file of installers('0.4.1', platform, arch)) await writeFile(path.join(source, file), `Fixture ${platform} ${arch}`)
    await stage('0.4.1', platform, arch, source, output)
  }
  return { source, output }
}
test('la etiqueta coincide con la versión y no acepta nombres de referencia arbitrarios', () => {
  assert.equal(releaseVersion('v0.4.1', '0.4.1'), '0.4.1')
  for (const tag of ['main', 'v0.4.2', 'v0.4.1\n', '--help', '../v0.4.1']) assert.throws(() => releaseVersion(tag, '0.4.1'))
  assert.throws(() => installers('../0.4.1', 'Linux', 'x64'))
  assert.throws(() => installers('0.4.1', 'macOS', 'unknown'))
})
test('las cuatro plataformas producen cinco instaladores y sumas verificables', async (t) => {
  const { output } = await fixture(t), files = await verifyAssets('0.4.1', output)
  assert.equal(files.length, 6)
  const sums = await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8')
  assert.equal(sums.trim().split('\n').length, 5)
  assert.match(sums, /Zai-0\.4\.1-macOS-arm64\.dmg/)
  assert.match(sums, /Zai-0\.4\.1-Windows-x64-Setup\.exe/)
  assert.deepEqual(await verifyAssets('0.4.1', output), files)
})
test('alterar un instalador impide publicar aunque los otros paquetes sean válidos', async (t) => {
  const { output } = await fixture(t)
  await writeFile(path.join(output, 'Zai-0.4.1-Linux-x64.AppImage'), 'Contenido alterado')
  await assert.rejects(verifyAssets('0.4.1', output), /SHA-256/)
})
test('la falta de una arquitectura o un archivo extra impide publicar una versión incompleta', async (t) => {
  const { output } = await fixture(t)
  const file = path.join(output, 'Zai-0.4.1-macOS-x64.dmg')
  await unlink(file)
  await assert.rejects(verifyAssets('0.4.1', output), /cuatro distribuciones/)
  await writeFile(file, 'Fixture macOS x64')
  await writeFile(path.join(output, 'otro-instalador.exe'), 'No forma parte de la distribución')
  await assert.rejects(verifyAssets('0.4.1', output), /cuatro distribuciones/)
})
test('un instalador vacío o un enlace simbólico no se acepta como paquete', async (t) => {
  const { source, output } = await fixture(t), name = 'Zai-0.4.1-Linux-x64.rpm'
  await writeFile(path.join(output, name), '')
  await assert.rejects(verifyAssets('0.4.1', output), /vacío/)
  if (process.platform !== 'win32') {
    await unlink(path.join(output, name)); await symlink(path.join(source, name), path.join(output, name))
    await assert.rejects(verifyAssets('0.4.1', output), /no regular/)
  }
})
