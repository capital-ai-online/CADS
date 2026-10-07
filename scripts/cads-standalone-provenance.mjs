import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function gitBlobSha(bytes) {
  const header = Buffer.from('blob ' + bytes.length + '\0');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

const manifest = JSON.parse(readFileSync(new URL('../evidence/source-export-manifest.json', import.meta.url), 'utf8'));
const files = manifest.files.map(entry => {
  const bytes = readFileSync(new URL('../' + entry.path, import.meta.url));
  const actual = gitBlobSha(bytes);
  if (actual !== entry.targetGitBlobSha) {
    throw new Error('CADS_TARGET_BLOB_MISMATCH path=' + entry.path + ' expected=' + entry.targetGitBlobSha + ' actual=' + actual);
  }
  if (entry.mode === 'BYTE_IDENTICAL' && entry.sourceGitBlobSha !== actual) {
    throw new Error('CADS_SOURCE_IDENTITY_MISMATCH path=' + entry.path);
  }
  return { path:entry.path, mode:entry.mode, gitBlobSha:actual, sha256:createHash('sha256').update(bytes).digest('hex'), status:'PASS' };
});
const report={schemaVersion:'CAPITAL_AI_CADS_STANDALONE_PROVENANCE@2',generatedAt:new Date().toISOString(),sourceRepository:manifest.sourceRepository,sourceCommit:manifest.sourceCommit,targetRepository:manifest.targetRepository,knownNonEvidence:manifest.knownNonEvidence,files,status:'PASS',authorityBoundary:{securityApproval:false,licenseApproval:false,productionApproval:false,marketplaceApproval:false}};
const target=process.argv[2] || 'security-reports/cads-standalone-provenance.json';
mkdirSync(dirname(target),{recursive:true});
writeFileSync(target,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report)+'\n');
