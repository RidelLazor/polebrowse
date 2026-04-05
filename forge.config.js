module.exports = {
  packagerConfig: {
    name: 'PoleBrowse',
    executableName: 'polebrowse',
    icon: './src/assets/pb-logo',
    asar: true, // enable asar for source protection
    asarUnpack: ['src/assets/**'], // keep assets accessible
    appBundleId: 'dev.ridell.polebrowse',
    appCategoryType: 'public.app-category.browsers',
    win32metadata: {
      CompanyName: 'RidelL',
      FileDescription: 'PoleBrowse Desktop Browser',
      ProductName: 'PoleBrowse',
    },
  },
  rebuildConfig: {},
  makers: [
    // ── LINUX ──────────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-zip',
      platforms: ['linux', 'darwin', 'win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          name: 'polebrowse',
          productName: 'PoleBrowse',
          genericName: 'Web Browser',
          description: 'PoleBrowse Desktop Browser by RidelL',
          categories: ['Network', 'WebBrowser'],
          icon: './src/assets/pb-logo.png',
          section: 'web',
          priority: 'optional',
          maintainer: 'RidelL',
          homepage: 'https://github.com/RidelLazor/polebrowse',
          mimeType: ['text/html', 'x-scheme-handler/http', 'x-scheme-handler/https'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          name: 'polebrowse',
          productName: 'PoleBrowse',
          description: 'PoleBrowse Desktop Browser by RidelL',
          categories: ['Network', 'WebBrowser'],
          icon: './src/assets/pb-logo.png',
          homepage: 'https://github.com/RidelLazor/polebrowse',
        },
      },
    },
    // ── WINDOWS ────────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'PoleBrowse',
        authors: 'RidelL',
        description: 'PoleBrowse Desktop Browser',
        iconUrl: 'https://raw.githubusercontent.com/RidelLazor/polebrowse/main/src/assets/pb-logo.ico',
        setupIcon: './src/assets/pb-logo.ico',
        setupExe: 'PoleBrowse-Setup.exe',
        noMsi: false,
      },
    },
    // ── MACOS ──────────────────────────────────────────────────────
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        name: 'PoleBrowse',
        format: 'ULFO',
      },
    },
  ],
};
