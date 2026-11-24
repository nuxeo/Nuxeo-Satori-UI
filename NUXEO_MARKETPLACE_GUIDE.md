# Nuxeo Marketplace Package — Build, Deploy & Startup Page Redirect Guide

This guide documents how to create a Nuxeo Marketplace package that deploys a custom UI to Nuxeo Cloud, sets it as the default landing page after login, and publishes to preprod via CI/CD.

Reference implementation: [nuxeo-csx-poc](https://github.com/nuxeo/nuxeo-csx-poc) on the `nuxeo-csx-package` branch.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [1. Parent POM](#1-parent-pom)
- [2. UI Module (nuxeo-csx-ui)](#2-ui-module-nuxeo-csx-ui)
- [3. Package Module (nuxeo-csx-package)](#3-package-module-nuxeo-csx-package)
  - [3a. Marketplace Metadata (package.xml)](#3a-marketplace-metadata-packagexml)
  - [3b. Installation Instructions (install.xml)](#3b-installation-instructions-installxml)
  - [3c. OSGi Bundle for Startup Page Redirect](#3c-osgi-bundle-for-startup-page-redirect)
  - [3d. Package POM with Antrun JAR Builder](#3d-package-pom-with-antrun-jar-builder)
  - [3e. Assembly Descriptor](#3e-assembly-descriptor)
- [4. Local Build](#4-local-build)
- [5. CI/CD — GitHub Actions](#5-cicd--github-actions)
  - [5a. Required GitHub Secrets](#5a-required-github-secrets)
  - [5b. Workflow Overview](#5b-workflow-overview)
  - [5c. Full Workflow File](#5c-full-workflow-file)
- [6. Deployment to Nuxeo Cloud (Preprod)](#6-deployment-to-nuxeo-cloud-preprod)
- [7. Adapting for Another Project](#7-adapting-for-another-project)
- [Troubleshooting](#troubleshooting)

---

## Project Structure

```
your-project/
├── pom.xml                          # Parent POM (multi-module)
├── your-ui/                         # Frontend app (Angular/React/etc.)
│   ├── pom.xml                      # Uses frontend-maven-plugin
│   ├── package.json
│   ├── .nvmrc
│   └── dist/                        # Build output (generated)
└── your-package/                    # Nuxeo Marketplace package
    ├── pom.xml                      # Antrun + Assembly plugins
    └── src/main/
        ├── resources/
        │   ├── package.xml          # Marketplace metadata
        │   └── install.xml          # Server installation instructions
        ├── bundle/                  # OSGi bundle source files
        │   ├── META-INF/
        │   │   └── MANIFEST.MF      # Declares Nuxeo components
        │   └── OSGI-INF/
        │       ├── login-startup-page-contrib.xml
        │       └── deployment-fragment.xml
        └── assemble/
            └── assembly.xml         # ZIP packaging descriptor
```

---

## Prerequisites

| Tool     | Version |
| -------- | ------- |
| Java JDK | 21      |
| Maven    | 3.9+    |
| Node.js  | 24.13.0 |
| npm      | 11.6.2  |

---

## 1. Parent POM

The parent POM defines the multi-module reactor and shared properties.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>org.nuxeo.yourproject</groupId>
  <artifactId>your-project-parent</artifactId>
  <version>2026.0.1-SNAPSHOT</version>
  <packaging>pom</packaging>
  <name>Your Project - Parent</name>

  <modules>
    <module>your-ui</module>
    <module>your-package</module>
  </modules>

  <properties>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <maven.compiler.source>21</maven.compiler.source>
    <maven.compiler.target>21</maven.compiler.target>
    <!-- Compile-time BOM for OSGi bundle Java code (see dependencyManagement below).
         In Nuxeo-Satori-UI this is 11.5.154. Runtime deployment target is declared separately in package.xml. -->
    <nuxeo.version>11.5.154</nuxeo.version>
    <node.version>v24.13.0</node.version>
    <npm.version>11.6.2</npm.version>
  </properties>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.nuxeo</groupId>
        <artifactId>nuxeo-parent</artifactId>
        <version>${nuxeo.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <repositories>
    <repository>
      <id>public</id>
      <url>https://packages.nuxeo.com/repository/maven-public</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </repository>
    <repository>
      <id>public-snapshot</id>
      <url>https://packages.nuxeo.com/repository/maven-public-snapshot</url>
      <releases><enabled>false</enabled></releases>
      <snapshots><updatePolicy>always</updatePolicy><enabled>true</enabled></snapshots>
    </repository>
  </repositories>

  <pluginRepositories>
    <pluginRepository>
      <id>public</id>
      <url>https://packages.nuxeo.com/repository/maven-public</url>
      <releases><enabled>true</enabled></releases>
      <snapshots><enabled>false</enabled></snapshots>
    </pluginRepository>
  </pluginRepositories>

</project>
```

> **Compile vs runtime Nuxeo version:** `nuxeo.version` in the parent POM imports the `nuxeo-parent` Maven BOM so Java OSGi modules (for example `nuxeo-agentic-core`) can resolve Nuxeo platform APIs at build time. In **Nuxeo-Satori-UI** this is `11.5.154`. The Marketplace **runtime** target platform is declared separately in `package.xml` (for example `[2025.0,2026.0)`). Do not assume these two version numbers must match.

---

## 2. UI Module (nuxeo-csx-ui)

This module builds the frontend app and outputs to `dist/`. It uses `frontend-maven-plugin` to install Node/npm and run the build.

```xml
<build>
  <plugins>
    <plugin>
      <groupId>com.github.eirslett</groupId>
      <artifactId>frontend-maven-plugin</artifactId>
      <version>1.15.0</version>
      <configuration>
        <nodeVersion>${node.version}</nodeVersion>
        <npmVersion>${npm.version}</npmVersion>
        <workingDirectory>${project.basedir}</workingDirectory>
      </configuration>
      <executions>
        <execution>
          <id>install node and npm</id>
          <goals><goal>install-node-and-npm</goal></goals>
        </execution>
        <execution>
          <id>npm install</id>
          <phase>process-resources</phase>
          <configuration><arguments>ci</arguments></configuration>
          <goals><goal>npm</goal></goals>
        </execution>
        <execution>
          <id>npm build</id>
          <phase>compile</phase>
          <configuration><arguments>run build:workspace</arguments></configuration>
          <goals><goal>npm</goal></goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

The build output at `dist/workspace-hxp` gets included in the marketplace ZIP under `web/nuxeo.war/csx-ui/`.

---

## 3. Package Module (nuxeo-csx-package)

This is where the marketplace ZIP is assembled. It includes the UI files, the OSGi bundle JAR, and installation metadata.

### 3a. Marketplace Metadata (package.xml)

`src/main/resources/package.xml` — describes the addon for the Nuxeo Marketplace.

```xml
<package type="addon" name="nuxeo-csx-ui" version="@VERSION@">
  <title>Nuxeo CSX UI</title>
  <description>
    <p>Angular workspace application with Nuxeo integration</p>
  </description>
  <vendor>Hyland Software</vendor>
  <installer restart="true" />
  <uninstaller restart="true" />
  <require-terms-and-conditions-acceptance>false</require-terms-and-conditions-acceptance>
  <license>Apache License, Version 2.0</license>
  <license-url>http://www.apache.org/licenses/LICENSE-2.0</license-url>
  <target-platform>
    <name>lts</name>
    <version>[2025.0,2026.0)</version>
  </target-platform>
  <visibility>PRIVATE</visibility>
</package>
```

> `@VERSION@` is replaced at build time by Maven resource filtering.

### 3b. Installation Instructions (install.xml)

`src/main/resources/install.xml` — tells the Nuxeo server how to install the package.

```xml
<install>
  <update file="${package.root}/install/bundles" todir="${env.bundles}" />
  <copy dir="${package.root}/web" todir="${env.server.home}/nxserver" overwrite="true" />
</install>
```

| Command                                          | What it does                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `<update ... todir="${env.bundles}">`            | Deploys the OSGi bundle JAR to `nxserver/bundles/` — Nuxeo loads it as a server component |
| `<copy ... todir="${env.server.home}/nxserver">` | Copies the web app to `nxserver/nuxeo.war/csx-ui/`                                        |

> **Critical**: Use `<update>` for bundles and `${env.bundles}` — NOT `<copy>` to a hardcoded path. This is how `nuxeo-web-ui` does it and is the only approach that works reliably on Nuxeo Cloud.

### 3c. OSGi Bundle for Startup Page Redirect

This is the key to making the login redirect work. Nuxeo requires a proper OSGi bundle JAR — dropping XML files in `nxserver/config/` does NOT work on Nuxeo Cloud.

#### `src/main/bundle/META-INF/MANIFEST.MF`

```
Manifest-Version: 1.0
Bundle-ManifestVersion: 1
Bundle-Name: Nuxeo CSX Core
Bundle-SymbolicName: org.nuxeo.csx.core;singleton:=true
Bundle-Version: 0.0.1
Bundle-Vendor: Hyland Software
Nuxeo-Component: OSGI-INF/login-startup-page-csx-contrib.xml
```

The `Nuxeo-Component` line tells Nuxeo which XML contributions to register when loading this bundle.

#### `src/main/bundle/OSGI-INF/login-startup-page-csx-contrib.xml`

Registers your UI path as the startup page after login.

```xml
<?xml version="1.0"?>
<component name="org.nuxeo.login.startup.page.csx.contrib">

  <extension target="org.nuxeo.ecm.platform.ui.web.auth.service.PluggableAuthenticationService"
             point="loginScreen">
    <loginScreenConfig>
      <startupPages>
        <startupPage id="csx" priority="1000">
          <path>csx-ui/</path>
        </startupPage>
      </startupPages>
    </loginScreenConfig>
  </extension>

</component>
```

| Field      | Value     | Notes                                               |
| ---------- | --------- | --------------------------------------------------- |
| `id`       | `csx`     | Unique identifier for your startup page             |
| `priority` | `1000`    | Must be higher than `nuxeo-web-ui` which uses `100` |
| `path`     | `csx-ui/` | Must match the subdirectory under `nuxeo.war`       |

> **Do NOT** add `<require>org.nuxeo.login.startup.page.web.contrib</require>` — if `nuxeo-web-ui` is not installed on the instance, the require will prevent your contribution from loading.

#### `src/main/bundle/OSGI-INF/deployment-fragment.xml`

Maps the Nuxeo authentication filter to your UI path so requests are properly authenticated.

```xml
<?xml version="1.0"?>
<fragment version="1">

  <extension target="web#WEB-INF/web.xml">
    <filter-mapping>
      <filter-name>NuxeoAuthenticationFilter</filter-name>
      <url-pattern>/csx-ui/*</url-pattern>
      <dispatcher>REQUEST</dispatcher>
      <dispatcher>FORWARD</dispatcher>
    </filter-mapping>
  </extension>

</fragment>
```

### 3d. Package POM with Antrun JAR Builder

The package module uses `maven-antrun-plugin` to create the OSGi bundle JAR from the files in `src/main/bundle/`, then `maven-assembly-plugin` to create the final marketplace ZIP.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/maven-v4_0_0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.nuxeo.csx</groupId>
    <artifactId>nuxeo-csx-ui-parent</artifactId>
    <version>2026.0.1-SNAPSHOT</version>
  </parent>

  <artifactId>nuxeo-csx-ui-package</artifactId>
  <packaging>pom</packaging>
  <name>Nuxeo CSX UI - Marketplace Package</name>

  <build>
    <resources>
      <resource>
        <directory>src/main/resources</directory>
        <filtering>true</filtering>
      </resource>
    </resources>

    <plugins>
      <!-- Filter package.xml (@VERSION@ replacement) -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-resources-plugin</artifactId>
        <version>3.3.1</version>
        <configuration>
          <useDefaultDelimiters>false</useDefaultDelimiters>
          <delimiters>
            <delimiter>@</delimiter>
          </delimiters>
        </configuration>
        <executions>
          <execution>
            <id>filter-resources</id>
            <phase>generate-resources</phase>
            <goals><goal>copy-resources</goal></goals>
            <configuration>
              <outputDirectory>${project.build.outputDirectory}</outputDirectory>
              <resources>
                <resource>
                  <directory>src/main/resources</directory>
                  <filtering>true</filtering>
                </resource>
              </resources>
            </configuration>
          </execution>
        </executions>
      </plugin>

      <!-- Build the Nuxeo OSGi bundle JAR -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-antrun-plugin</artifactId>
        <version>3.1.0</version>
        <executions>
          <execution>
            <id>create-bundle-jar</id>
            <phase>prepare-package</phase>
            <goals><goal>run</goal></goals>
            <configuration>
              <target>
                <jar destfile="${project.build.directory}/nuxeo-csx-core.jar"
                     manifest="${project.basedir}/src/main/bundle/META-INF/MANIFEST.MF">
                  <fileset dir="${project.basedir}/src/main/bundle">
                    <include name="OSGI-INF/**"/>
                  </fileset>
                </jar>
              </target>
            </configuration>
          </execution>
        </executions>
      </plugin>

      <!-- Assemble the marketplace ZIP -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-assembly-plugin</artifactId>
        <version>3.6.0</version>
        <configuration>
          <descriptors>
            <descriptor>src/main/assemble/assembly.xml</descriptor>
          </descriptors>
          <finalName>nuxeo-csx-ui-package-${project.version}</finalName>
          <appendAssemblyId>false</appendAssemblyId>
        </configuration>
        <executions>
          <execution>
            <id>create-archive</id>
            <phase>package</phase>
            <goals><goal>single</goal></goals>
          </execution>
        </executions>
        <dependencies>
          <dependency>
            <groupId>org.apache.maven.shared</groupId>
            <artifactId>maven-filtering</artifactId>
            <version>3.3.1</version>
          </dependency>
        </dependencies>
      </plugin>
    </plugins>
  </build>

</project>
```

### 3e. Assembly Descriptor

`src/main/assemble/assembly.xml` — defines what goes into the marketplace ZIP.

```xml
<assembly xmlns="http://maven.apache.org/ASSEMBLY/2.1.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/ASSEMBLY/2.1.0 http://maven.apache.org/xsd/assembly-2.1.0.xsd">
  <id>package</id>
  <formats>
    <format>zip</format>
  </formats>
  <includeBaseDirectory>false</includeBaseDirectory>

  <fileSets>
    <!-- Marketplace metadata -->
    <fileSet>
      <directory>src/main/resources</directory>
      <outputDirectory>/</outputDirectory>
      <includes>
        <include>package.xml</include>
        <include>install.xml</include>
      </includes>
    </fileSet>

    <!-- OSGi bundle JAR (built by antrun) -->
    <fileSet>
      <directory>${project.build.directory}</directory>
      <outputDirectory>/install/bundles</outputDirectory>
      <includes>
        <include>nuxeo-csx-core.jar</include>
      </includes>
    </fileSet>

    <!-- Frontend application files -->
    <fileSet>
      <directory>../nuxeo-csx-ui/dist/workspace-hxp</directory>
      <outputDirectory>/web/nuxeo.war/csx-ui</outputDirectory>
      <includes>
        <include>**/*</include>
      </includes>
    </fileSet>
  </fileSets>
</assembly>
```

The resulting ZIP structure:

```
nuxeo-csx-ui-package-VERSION.zip
├── package.xml
├── install.xml
├── install/
│   └── bundles/
│       └── nuxeo-csx-core.jar    # OSGi bundle (startup page + auth filter)
└── web/
    └── nuxeo.war/
        └── csx-ui/               # Your frontend application
            ├── index.html
            ├── main.js
            └── ...
```

---

## 4. Local Build

```bash
# Set Node version
nvm use 24.13.0

# Authenticate for private npm packages (if needed)
export GH_PACKAGES_READ_ONLY_TOKEN=<your-github-pat>

# Install frontend dependencies
cd nuxeo-csx-ui
npm ci

# Build the frontend
npm run build:workspace

# Build the marketplace package
cd ..
mvn clean package -pl nuxeo-csx-package -B

# Output ZIP location:
ls nuxeo-csx-package/target/*.zip
```

---

## 5. CI/CD — GitHub Actions

### 5a. Required GitHub Secrets

| Secret                        | Purpose                                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `GH_PACKAGES_READ_ONLY_TOKEN` | GitHub PAT with `read:packages` scope for `@hylandsoftware` npm packages |
| `CONNECT_PREPROD_USERNAME`    | Nuxeo Connect preprod username                                           |
| `CONNECT_PREPROD_PASSWORD`    | Nuxeo Connect preprod token/password                                     |

### 5b. Workflow Overview

The CI workflow (`.github/workflows/build-package.yml`) has 3 jobs:

1. **`properties`** — Resolves the build version from `pom.xml`
   - Push to `nuxeo-csx-package` branch: `2026.0.1-20260408125839` (timestamped)
   - Pull request: `2026.0.1-PR-42-BUILD-123`
   - Other: `2026.0.1-SNAPSHOT`

2. **`build`** — Builds the frontend + marketplace package
   - Checks out code
   - Sets up JDK 21 + Node.js 24.13.0
   - Updates Maven version and `package.xml` version
   - Runs `npm ci` and `npm run build:workspace`
   - Substitutes environment variables in `app.config.json`
   - Runs `mvn clean package -pl nuxeo-csx-package`
   - Uploads the ZIP as a GitHub Actions artifact (30-day retention)

3. **`push-to-preprod`** — Publishes to Nuxeo Marketplace staging
   - Only runs on pushes to `nuxeo-csx-package` branch (not PRs)
   - Downloads the ZIP artifact
   - Publishes via `nos-publish` action to Nuxeo Connect preprod

### 5c. Full Workflow File

`.github/workflows/build-package.yml`:

```yaml
name: Build & Package

on:
  push:
    branches:
      - nuxeo-csx-package
  pull_request:
    branches:
      - nuxeo-csx-package

concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

env:
  MAVEN_OPTS: >-
    -Dorg.slf4j.simpleLogger.log.org.apache.maven.cli.transfer.Slf4jMavenTransferListener=warn
    -Daether.syncContext.named.time=600
    -Xms512m -Xmx1g

permissions:
  contents: read
  packages: read
  checks: write
  pull-requests: write

jobs:
  properties:
    runs-on: ubuntu-latest
    outputs:
      VERSION: ${{ steps.env.outputs.VERSION }}
      IS_MAIN: ${{ steps.env.outputs.IS_MAIN }}
    steps:
      - uses: actions/checkout@v4

      - name: Resolve version info
        id: env
        run: |
          set -e
          CURRENT_VERSION=$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout | grep -v '\[' | head -n 1 | xargs)
          BASE_VERSION=${CURRENT_VERSION%-SNAPSHOT}
          IS_MAIN=false

          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            VERSION="${BASE_VERSION}-PR-${{ github.event.number }}-BUILD-${{ github.run_number }}"
          elif [[ "${{ github.ref }}" == "refs/heads/nuxeo-csx-package" ]]; then
            VERSION="${BASE_VERSION}-$(date +%Y%m%d%H%M%S)"
            IS_MAIN=true
          else
            VERSION="${BASE_VERSION}-SNAPSHOT"
          fi

          echo "VERSION=$VERSION" >> "$GITHUB_OUTPUT"
          echo "IS_MAIN=$IS_MAIN" >> "$GITHUB_OUTPUT"

  build:
    needs: properties
    runs-on: ubuntu-latest
    env:
      VERSION: ${{ needs.properties.outputs.VERSION }}
      IS_MAIN: ${{ needs.properties.outputs.IS_MAIN }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: 'maven'

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24.13.0'
          cache: 'npm'
          cache-dependency-path: nuxeo-csx-ui/package-lock.json
          registry-url: 'https://npm.pkg.github.com'
          scope: '@hylandsoftware'

      - name: Update Maven version
        run: mvn versions:set -DnewVersion=$VERSION -DgenerateBackupPoms=false

      - name: Update package.xml version
        run: |
          PACKAGE_XML="nuxeo-csx-package/src/main/resources/package.xml"
          sed -i "s/version=\"[^\"]*\"/version=\"$VERSION\"/" "$PACKAGE_XML"

      - name: Install npm dependencies
        working-directory: nuxeo-csx-ui
        run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GH_PACKAGES_READ_ONLY_TOKEN }}
          GH_PACKAGES_READ_ONLY_TOKEN: ${{ secrets.GH_PACKAGES_READ_ONLY_TOKEN }}

      - name: Build Angular application
        working-directory: nuxeo-csx-ui
        run: npm run build:workspace

      - name: Build Maven package
        run: |
          mvn clean package -pl nuxeo-csx-package -B -V -nsu --no-transfer-progress
          ls nuxeo-csx-package/target/*.zip

      - name: Upload package artifact
        uses: actions/upload-artifact@v4
        with:
          name: nuxeo-csx-ui-package
          path: nuxeo-csx-package/target/*.zip
          retention-days: 30
          if-no-files-found: error

  push-to-preprod:
    needs: [properties, build]
    runs-on: ubuntu-latest
    if: needs.properties.outputs.IS_MAIN == 'true'
    env:
      VERSION: ${{ needs.properties.outputs.VERSION }}
    steps:
      - name: Download package
        uses: actions/download-artifact@v4
        with:
          name: nuxeo-csx-ui-package
          path: packages

      - name: Publish to Nuxeo Marketplace (Preprod)
        uses: Alfresco/alfresco-build-tools/.github/actions/nuxeo/nos-publish@v12.10.3
        with:
          nos-env: staging
          nos-username: ${{ secrets.CONNECT_PREPROD_USERNAME }}
          nos-token: ${{ secrets.CONNECT_PREPROD_PASSWORD }}
          skip-verify: 'false'
          package-path: packages/nuxeo-csx-ui-package-${{ env.VERSION }}.zip
```

---

## 6. Deployment to Nuxeo Cloud (Preprod)

After the CI pipeline completes:

1. The package ZIP is automatically published to **Nuxeo Connect preprod (staging)**
2. Go to your Nuxeo Cloud console and install the package on your environment
3. The server will restart (as specified in `package.xml`)
4. After restart:
   - The OSGi bundle registers `/csx-ui/` as the startup page with priority `1000`
   - The `NuxeoAuthenticationFilter` is mapped to `/csx-ui/*`
   - Users logging in will be redirected to `/nuxeo/csx-ui/` instead of `/nuxeo/home.html`

---

## 7. Adapting for Another Project

To replicate this for a different project, change these values:

| What to change         | Where                                                                       | Example                                     |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| Group ID / Artifact ID | All `pom.xml` files                                                         | `org.nuxeo.yourproject`                     |
| Package name           | `package.xml` `name` attribute                                              | `nuxeo-your-ui`                             |
| UI path                | `assembly.xml`, `login-startup-page-contrib.xml`, `deployment-fragment.xml` | `your-ui/`                                  |
| Startup page `id`      | `login-startup-page-contrib.xml`                                            | `your-ui`                                   |
| Component name         | `MANIFEST.MF`, `login-startup-page-contrib.xml`                             | `org.nuxeo.login.startup.page.your.contrib` |
| Bundle symbolic name   | `MANIFEST.MF`                                                               | `org.nuxeo.your.core`                       |
| JAR filename           | `pom.xml` antrun target, `assembly.xml` include                             | `nuxeo-your-core.jar`                       |
| CI branch name         | `build-package.yml` trigger                                                 | `your-branch`                               |
| Target platform        | `package.xml` version range                                                 | `[2025.0,2026.0)`                           |
| Build command          | `package.json` scripts                                                      | `npm run build:your-app`                    |
| Dist output path       | `assembly.xml` fileSet directory                                            | `../your-ui/dist/your-app`                  |
| Nuxeo Cloud URL        | Workflow env vars (`APP_CONFIG_ECM_HOST` etc.)                              | `https://your-instance.nuxeocloud.com`      |

---

## Troubleshooting

### Login redirects to `/nuxeo/home.html` instead of your UI

- Verify the OSGi bundle JAR is inside the ZIP at `install/bundles/`
- Verify `install.xml` uses `<update ... todir="${env.bundles}" />` (NOT `<copy>` to a hardcoded path)
- Verify `MANIFEST.MF` has `Nuxeo-Component:` pointing to the correct XML file
- Do NOT use `<require>` on `nuxeo-web-ui` — the instance may not have it installed
- Restart the Nuxeo server after package installation

### `npm ci` fails with picomatch version mismatch

Run `npm install` locally to regenerate `package-lock.json`, commit, and push.

### `npm ci` fails with 401 Unauthorized

The `GH_PACKAGES_READ_ONLY_TOKEN` secret is missing or expired. Create a new GitHub PAT with `read:packages` scope.

### Maven can't find `nuxeo-csx-core` dependency

Don't add `nuxeo-csx-core` as a Maven dependency. The JAR is built by `maven-antrun-plugin` inside the package module and included via `assembly.xml` fileSet — no cross-module dependency needed.

### Can't push workflow file changes

GitHub requires the `workflow` scope on your token to update `.github/workflows/` files. Use SSH (`git push git@github.com:...`) or a PAT with the `workflow` scope.
