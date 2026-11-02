# SonarCloud Integration Setup

This document outlines the steps to complete SonarCloud integration for the Nuxeo Agentic UI project.

## Prerequisites

- Admin access to the GitHub repository
- SonarCloud account (free for open-source projects, paid for private repos)
- Access to repository secrets management

## Step 1: Set Up SonarCloud Project

1. **Go to SonarCloud**: Navigate to [sonarcloud.io](https://sonarcloud.io)

2. **Sign in with GitHub**: Use your GitHub account to authenticate

3. **Create New Organization** (if needed):
   - Click on the `+` icon in the top right
   - Select "Analyze new project"
   - Import your GitHub organization

4. **Add the Repository**:
   - Select the `Nuxeo-Satori-UI` repository
   - Click "Set Up"
   - The project already exists under the key `nuxeo_agentic-ui-poc`, which SonarCloud derived from
     the repository's former name and did not change when GitHub renamed the repository on
     30 October 2026. Adding the repository again would create a second, empty project — use the
     existing one, and leave `sonar.projectKey` in `sonar-project.properties` alone.

5. **Configure Analysis Method**:
   - Choose "With GitHub Actions" as the analysis method
   - Note the following values provided by SonarCloud:
     - `SONAR_TOKEN`
     - `SONAR_ORGANIZATION`
     - `SONAR_PROJECT_KEY`

## Step 2: Configure GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to: **Settings** → **Secrets and variables** → **Actions**

2. Click **New repository secret** and add:

   | Secret Name          | Description                      | Where to Find                      |
   | -------------------- | -------------------------------- | ---------------------------------- |
   | `SONAR_TOKEN`        | SonarCloud authentication token  | SonarCloud → My Account → Security |
   | `SONAR_ORGANIZATION` | Your SonarCloud organization key | SonarCloud project settings        |
   | `SONAR_PROJECT_KEY`  | Unique project identifier        | SonarCloud project settings        |

## Step 3: Update Configuration Files

### Update sonar-project.properties

Replace the placeholder values in `sonar-project.properties`:

```properties
sonar.organization=<your-organization-key>
sonar.projectKey=<your-project-key>
```

**Note**: These can also be passed via the GitHub Actions workflow (recommended for security).

## Step 4: Configure Quality Gates (Optional)

In SonarCloud:

1. Navigate to **Project Settings** → **Quality Gate**
2. Choose or create a quality gate
3. Recommended settings for this project:
   - Coverage on new code: ≥ 80%
   - Duplicated lines on new code: ≤ 3%
   - Maintainability rating on new code: A
   - Reliability rating on new code: A
   - Security rating on new code: A

## Step 5: Enable Branch Analysis

For PR analysis to work properly:

1. In SonarCloud, go to **Administration** → **General Settings** → **Pull Requests**
2. Ensure "Automatic analysis" is **disabled** (we use GitHub Actions)
3. Verify "Decorate Pull Requests" is **enabled**

## Step 6: Test the Integration

1. **Push to a feature branch**:

   ```bash
   git checkout -b test/sonarcloud-integration
   git add .
   git commit -m "test: verify SonarCloud integration"
   git push origin test/sonarcloud-integration
   ```

2. **Create a Pull Request**

3. **Verify the workflow runs**:
   - Check the "Actions" tab in GitHub
   - Look for the "SonarCloud Analysis" workflow
   - Verify it completes successfully

4. **Check SonarCloud**:
   - Go to your SonarCloud project dashboard
   - Verify that the analysis results appear
   - Check that PR decoration is working (SonarCloud comments on the PR)

## Step 7: Configure Branch Protection Rules (Optional)

Add SonarCloud quality gate as a required check:

1. Go to **Settings** → **Branches** → **Branch protection rules** for `main`
2. Enable "Require status checks to pass before merging"
3. Search for and add: `SonarCloud Code Analysis`
4. Save changes

## Troubleshooting

### Coverage Not Showing

- Ensure tests are running with coverage enabled
- Verify `lcov.info` files are generated in the `coverage/` directory
- Check the paths in `sonar.typescript.lcov.reportPaths`

### Analysis Failing

- Check GitHub Actions logs for specific error messages
- Verify all secrets are correctly configured
- Ensure the SonarCloud token has not expired

### PR Decoration Not Working

- Verify the GitHub App is installed for your organization
- Check that `GITHUB_TOKEN` permissions are sufficient
- Ensure the PR is from the same repository (not a fork)

## Integration with Existing CI

The SonarCloud workflow runs independently of the main CI workflow ([ci.yml](.github/workflows/ci.yml)) to:

- Avoid blocking the primary CI pipeline
- Allow separate failure handling
- Enable independent scheduling and triggering

Both workflows run on the same triggers (PR to main, pushes to main/feature/fix branches).

## Nx Monorepo Considerations

This setup analyzes the entire monorepo. For per-project analysis:

1. Coverage is aggregated from all projects
2. You can configure project-specific exclusions in `sonar-project.properties`
3. Consider using SonarCloud's "sub-projects" feature for independent quality gates per app/lib

## Cost Considerations

- **Open source**: Free on SonarCloud
- **Private repositories**: Requires a paid plan
  - Check [SonarCloud pricing](https://sonarcloud.io/pricing) for current rates
  - LOC (Lines of Code) determines the pricing tier

## Next Steps

1. Configure [Quality Profiles](https://sonarcloud.io/documentation/user-guide/quality-profiles/) specific to TypeScript/Angular
2. Set up [New Code Definition](https://sonarcloud.io/documentation/user-guide/new-code-definition/) to match your development workflow
3. Enable [Security Hotspots](https://sonarcloud.io/documentation/user-guide/security-hotspots/) review
4. Integrate SonarCloud badge in README.md:
   ```markdown
   [![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=<project-key>&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=<project-key>)
   ```

## Reference

- [SonarCloud Documentation](https://sonarcloud.io/documentation)
- [GitHub Actions Integration](https://github.com/SonarSource/sonarcloud-github-action)
- [TypeScript Analysis](https://docs.sonarcloud.io/enriching/languages/typescript/)
