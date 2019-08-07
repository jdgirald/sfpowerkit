import {
  core,
  SfdxCommand,
  flags,
  FlagsConfig,
  SfdxResult
} from "@salesforce/command";

import { SfdxProject, Org } from "@salesforce/core";
import _ from "lodash";
import { SfPowerKit } from "../../../../sfpowerkit";
import { METADATA_INFO } from "../../../../shared/metadataInfo";
import * as path from "path";
import ProfileReconcile from "../../../../impl/source/profiles/profileReconcile";
import MetadataFiles from "../../../../shared/metadataFiles";

// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = core.Messages.loadMessages("sfpowerkit", "profile_reconcile");

export default class Reconcile extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");

  public static examples = [
    `$ sfdx sfpowerkit:source:profile:reconcile  --folder force-app -d destfolder -s`,
    `$ sfdx sfpowerkit:source:profile:reconcile  --folder force-app,module2,module3 -u sandbox -d destfolder`,
    `$ sfdx sfpowerkit:source:profile:reconcile  -u myscratchorg -d destfolder`
  ];

  //public static args = [{name: 'file'}];

  protected static flagsConfig: FlagsConfig = {
    // flag with a value (-n, --name=VALUE)
    folder: flags.array({
      char: "f",
      description: messages.getMessage("folderFlagDescription"),
      required: false,
      map: (f: string) => f.trim()
    }),
    profilelist: flags.array({
      char: "n",
      description: messages.getMessage("nameFlagDescription"),
      required: false,
      map: (n: string) => n.trim()
    }),
    destfolder: flags.directory({
      char: "d",
      description: messages.getMessage("destFolderFlagDescription"),
      required: true
    }),
    sourceonly: flags.boolean({
      char: "s",
      description: messages.getMessage("sourceonlyFlagDescription"),
      required: false
    }),
    targetorg: flags.string({
      char: "u",
      description: messages.getMessage("targetorgFlagDescription"),
      required: false
    })
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  //protected static supportsDevhubUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = true;

  public static result: SfdxResult = {
    tableColumnData: {
      columns: [
        { key: "state", label: "State" },
        { key: "fullName", label: "Full Name" },
        { key: "type", label: "Type" },
        { key: "path", label: "Path" }
      ]
    },
    display() {
      if (Array.isArray(this.data) && this.data.length) {
        this.ux.table(this.data, this.tableColumnData);
      }
    }
  };

  public async run(): Promise<any> {
    // tslint:disable-line:no-any
    SfPowerKit.ux = this.ux;

    let argFolder = this.flags.folder;
    let argProfileList = this.flags.profilelist;
    if (!this.flags.sourceonly) {
      if (_.isNil(this.flags.targetorg)) {
        throw new Error(
          "Either set sourceonly flag or provide and org for reconcile"
        );
      } else {
        this.org = await Org.create({ aliasOrUsername: this.flags.targetorg });
      }
    }

    MetadataFiles.sourceOnly = this.flags.sourceonly;

    if (_.isNil(argFolder) || argFolder.length === 0) {
      argFolder = [];
      const dxProject = await SfdxProject.resolve();
      const project = await dxProject.retrieveSfdxProjectJson();

      let packages = (project.get("packageDirectories") as any[]) || [];
      packages.forEach(element => {
        argFolder.push(element.path);
        if (element.default) {
          SfPowerKit.defaultFolder = element.path;
        }
      });
    } else {
      SfPowerKit.defaultFolder = argFolder[0];
    }

    var profileUtils = new ProfileReconcile(
      this.org,
      this.flags.loglevel == "debug"
    );

    var reconcileProfiles = await profileUtils.reconcile(
      argFolder,
      argProfileList || [],
      this.flags.destfolder
    );

    // Return an object to be displayed with --json
    let result = [];
    reconcileProfiles.forEach(file => {
      result.push({
        state: "Cleaned",
        fullName: path.basename(file, METADATA_INFO.Profile.sourceExtension),
        type: "Profile",
        path: path.relative(process.cwd(), file)
      });
    });

    return result;
  }
}
