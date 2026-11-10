const { version } = require('../package.json');
const changelog = require('../public/changelog.json');

// Snapshot the deployed source at process startup; never expose package/config objects.
function versionInfo() {
  return {
    systemName: 'Asset Inventory System',
    version,
    releases: changelog.releases.map(({ version, date, features, improvements, fixes }) => ({
      version, date, features, improvements, fixes
    }))
  };
}

function versionHandler(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(versionInfo());
}

module.exports = { versionInfo, versionHandler };
