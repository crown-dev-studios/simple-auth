const fs = require('node:fs')
const path = require('node:path')

const distDir = path.join(__dirname, '..', '.test-dist')
fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))

