# Moonlit Desk

A local-first Hexo writing and publishing tool with a native macOS menu bar app.

Write in a rich-text editor or switch to Markdown. Insert, drop, or paste images,
publish a generated site to GitHub, and keep deduplicated versions of articles and
their local assets. Connect your own Hexo project without changing the tool's source.

## Requirements

- macOS 13 or later for the menu bar app
- Node.js 20 or later and npm
- An existing Hexo project with its dependencies installed
- Git and GitHub CLI for publishing
- Xcode Command Line Tools to build the Swift app

The browser editor can also run directly with Node.js.

## Get started

~~~sh
npm ci
npm run configure -- /path/to/hexo-blog
npm start
~~~

Open http://127.0.0.1:4510/.

For a temporary project selection without updating your settings:

~~~sh
npm start -- --project /path/to/hexo-blog
~~~

The selected directory must contain _config.yml and package.json.
Custom source_dir settings are supported. Install the project's own Hexo
dependencies in that project before starting its server or publishing.

## macOS menu bar app

~~~sh
npm run build:mac
open "Moonlit Desk.app"
~~~

On first launch, choose your Hexo project. You can change it later using
**选择博客目录…**. Use **新建 Hexo 博客…** to choose a parent folder and create
a new site. Creation installs Hexo and verifies a successful build before connecting
the site; Node.js 20.19 or newer and network access are required. The app includes the editor runtime and reads the selected
project from local settings. Rebuilding is unnecessary when changing blogs.

The menu supports starting and stopping Hexo, opening the editor, manual or
scheduled whole-project backups, and launching at login. The local Hexo preview
uses port 4000 and the editor uses port 4510.

## Menu bar appearance and moon phase

The menu bar shows only a live moon icon by default. **月相与菜单栏显示…** lets
you add the app name or the current site's name, or replace the moon with a custom
symbol. Changes persist across launches; site names follow `_config.yml` changes.

Moon illumination follows the current time, including daytime and times when the
Moon is below the horizon. System location adjusts the illuminated limb's angle
for the observer. Allow macOS location access, or disable automatic location and
enter latitude/longitude in the settings panel. If location is unavailable, the
phase remains current with a standard orientation. Coordinates stay on this Mac.
The compact icon uses approximate SunCalc astronomy formulas, not an observation
of visibility or weather. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Writing

Common controls stay visible: undo/redo, headings, bold, italic, underline, lists,
links, and images. **高级** expands strikethrough, sub/superscript, inline and block
code, tables (including adding rows and removing a table), separators, indentation,
removing links/formatting, and optional folded content. Formatting buttons reflect
the current selection. Rich-only controls are disabled in Markdown mode. Click **MD 编辑器** to edit the full Markdown source, including YAML
front matter. Its label changes to **富文本编辑器**, which returns to rich-text mode.

Opening an article or switching modes preserves the original source until you
edit it. Embedded HTML, such as video players, is retained as a protected card
and can be edited in Markdown. YAML errors are reported before saving.
New posts start without a translation section. Use **折叠内容** to insert an
optional section with your own heading. It opens while editing and stays collapsed
on the published page until a reader clicks its heading. Existing sections are preserved.

Expand **文章属性** to edit titles and date, select tags and categories, and add
keywords. **网站设置** manages the site name, description, keywords, and shared
tags/categories/keywords. Renaming or removing a shared entry updates matching
articles after backing up their previous and new versions.

Fill in any one of the title, Chinese title, or filename fields to create a post.
English titles generate hyphenated filenames. Chinese titles generate pinyin
filenames separated by underscores. A manually supplied filename takes priority.

Images support PNG, JPEG, GIF, and WebP, up to 10 MB each. Uploaded files are stored
under images/editor/ inside the configured Hexo content directory.

## Backups

Article versions include Markdown and referenced local assets. Each version is
addressed by its content hash. Repeated saves, publications, and reversions reuse
an existing identical version. Overwriting an article first backs up the old and
new content. A backup failure leaves the original article file intact.

A single detected OneDrive folder is used by default. Otherwise backups use local
Application Support storage. You can set a custom backup folder in the menu.
OneDrive's client handles uploading locally written backups to the cloud.

Whole-project ZIP backups also skip identical content. Archives omit generated
output, dependencies, Git data, and runtime cache folders.

Local settings live outside this repository:

~~~text
~/Library/Application Support/Moonlit Desk/settings.json
~~~

Supported keys are projectPath, backupFolder, and bilingual. CLI environment
overrides include MOONLIT_PROJECT, MOONLIT_ARTICLE_BACKUPS, MOONLIT_SETTINGS,
and EDITOR_PORT.

## GitHub publishing

Open **网站设置 → GitHub 发布** to set a repository, branch, and public site URL.
You can create a public or private repository there after logging in with
`gh auth login`. Optionally enable GitHub Pages from the deployment branch.
Use the full site URL, including the repository path for GitHub Pages project sites.

The publish button saves the active article and builds the entire site from a
temporary snapshot. A draft is moved into _posts/ after confirmation.
The generated site is committed and pushed using the project's deployment settings.

~~~yaml
deploy:
  type: git
  repo: https://github.com/YOUR_ACCOUNT/YOUR_SITE.git
  branch: main
~~~

Both repo and repository are accepted. When the branch is omitted,
Moonlit Desk reads the repository's default branch. Authenticate with
gh auth login and configure your own Git author name and email before publishing.
Credentials remain managed by GitHub CLI.

The deployment branch receives generated site files. Markdown and local assets
are stored separately in the version backups. Existing unrelated repository files
are retained. Files generated by a previous Moonlit Desk deployment can be removed
when they are absent from the next build. Pushes use normal fast-forward rules.

## Development

~~~sh
npm test
npm run build:mac
~~~

Tests create a temporary Hexo project and local bare Git repository. They work
without a personal blog, cloud account, or GitHub credentials.

The menu bar's LauncherFeature protocol provides menuItems() and shutdown() hooks
for additional features. The editor, publisher, and backup services live in editor/.
Native process management and whole-project backups live in mac-launcher/.

## License

MIT. See [LICENSE](LICENSE). Third-party dependencies retain their own licenses.

On macOS, run `npm run test:mac` to verify moon illumination and observer orientation against SunCalc reference fixtures.
