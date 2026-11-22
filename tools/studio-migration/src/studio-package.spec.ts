import { readStudioPackage, StudioPackageError } from './studio-package';
import {
  SYNTHETIC_BUNDLE,
  syntheticBundleFiles,
  syntheticPackage,
} from './testing/synthetic-package';
import { writeZip } from './testing/zip-writer';
import { ZipError } from './zip';

describe('readStudioPackage', () => {
  it('reads the descriptor and opens the bundle install.xml installs', () => {
    const pkg = readStudioPackage(syntheticPackage());
    expect(pkg.descriptor).toEqual({
      type: 'studio',
      name: 'Acme-Claims',
      version: '1.0.0',
      targetPlatform: '[2025.0,2026)',
      targetPlatformName: 'lts',
      dependencies: ['nuxeo-web-ui'],
    });
    expect(pkg.bundlePath).toBe(SYNTHETIC_BUNDLE);
    expect([...pkg.packageFiles.keys()]).toEqual([
      'package.xml',
      'install.xml',
      'studio-registries.json',
      SYNTHETIC_BUNDLE,
    ]);
    expect([...pkg.bundleFiles.keys()].sort()).toEqual(Object.keys(syntheticBundleFiles()).sort());
  });

  it('falls back to the only JAR when install.xml names none', () => {
    const jar = writeZip([{ name: 'a.txt', data: 'a' }]);
    const archive = writeZip([
      { name: 'package.xml', data: '<package type="studio" name="p" version="1"/>' },
      { name: 'p.jar', data: jar },
    ]);
    expect(readStudioPackage(archive).bundlePath).toBe('p.jar');
  });

  // Negative controls: each package below is wrong in one way, and each must be refused.
  describe('refuses', () => {
    const descriptor = '<package type="studio" name="p" version="1"/>';
    const jar = writeZip([{ name: 'a.txt', data: 'a' }]);
    const refusal = (archive: Buffer): Error => {
      try {
        readStudioPackage(archive);
      } catch (error) {
        return error as Error;
      }
      throw new Error('the package was accepted');
    };

    it('a ZIP with no package.xml', () => {
      const error = refusal(writeZip([{ name: 'p.jar', data: jar }]));
      expect(error).toBeInstanceOf(StudioPackageError);
      expect(error.message).toMatch(/no package\.xml/);
    });

    it('a package of another type', () => {
      const archive = writeZip([
        { name: 'package.xml', data: '<package type="addon" name="p" version="1"/>' },
        { name: 'p.jar', data: jar },
      ]);
      expect(refusal(archive).message).toMatch(/"addon" package, not a Studio package/);
    });

    it('a package.xml that is not well-formed', () => {
      const archive = writeZip([
        { name: 'package.xml', data: '<package type="studio">' },
        { name: 'p.jar', data: jar },
      ]);
      expect(refusal(archive).message).toMatch(/package\.xml is not well-formed XML/);
    });

    it('a package with no bundle', () => {
      const archive = writeZip([{ name: 'package.xml', data: descriptor }]);
      expect(refusal(archive).message).toMatch(/holds no bundle/);
    });

    it('two JARs and nothing to say which is the bundle', () => {
      const archive = writeZip([
        { name: 'package.xml', data: descriptor },
        { name: 'a.jar', data: jar },
        { name: 'b.jar', data: jar },
      ]);
      expect(refusal(archive).message).toMatch(/2 JARs .* does not say which/);
    });

    it('an install.xml naming a bundle the package does not hold', () => {
      const archive = writeZip([
        { name: 'package.xml', data: descriptor },
        {
          name: 'install.xml',
          data: '<install><update file="${package.root}/missing.jar"/></install>',
        },
        { name: 'p.jar', data: jar },
      ]);
      expect(refusal(archive).message).toMatch(
        /installs missing\.jar, which the package does not hold/,
      );
    });

    it('a bundle that is not a ZIP, naming the bundle', () => {
      const archive = writeZip([
        { name: 'package.xml', data: descriptor },
        { name: 'p.jar', data: 'not a zip, but long enough to be searched for an end record' },
      ]);
      const error = refusal(archive);
      expect(error).toBeInstanceOf(ZipError);
      expect(error.message).toMatch(/^p\.jar: not a ZIP archive/);
    });
  });
});
