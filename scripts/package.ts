import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { zipSync } from 'fflate'

mkdirSync('build/dist', { recursive: true })

for (const name of readdirSync('plugins')) {
	const dir = `plugins/${name}`
	const manifestRaw = readFileSync(`${dir}/manifest.json`)
	const manifest = JSON.parse(manifestRaw.toString())
	const script = readFileSync(`${dir}/build/js/index.js`)

	const zip = zipSync({
		'manifest.json': manifestRaw,
		[manifest.dist.script]: script,
	})
	const out = `build/dist/${manifest.id}@${manifest.version}.zip`
	writeFileSync(out, zip)
	console.log(`packaged ${manifest.id} -> ${out}`)
}
