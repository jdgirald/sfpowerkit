import { Connection } from "jsforce";
import * as _ from "lodash";
import * as xml2js from "xml2js";
import * as fs from "fs";
import * as path from "path";
import FileUtils from "../../utils/fileutils";
import { FileProperties } from "jsforce";

if (Symbol["asyncIterator"] === undefined) {
  // tslint:disable-next-line:no-any
  (Symbol as any)["asyncIterator"] = Symbol.for("asyncIterator");
}

const STANDARD_VALUE_SETS = [
  "AccountContactMultiRoles",
  "AccountContactRole",
  "AccountOwnership",
  "AccountRating",
  "AccountType",
  "AddressCountryCode",
  "AddressStateCode",
  "AssetStatus",
  "CampaignMemberStatus",
  "CampaignStatus",
  "CampaignType",
  "CaseContactRole",
  "CaseOrigin",
  "CasePriority",
  "CaseReason",
  "CaseStatus",
  "CaseType",
  "ContactRole",
  "ContractContactRole",
  "ContractStatus",
  "EntitlementType",
  "EventSubject",
  "EventType",
  "FiscalYearPeriodName",
  "FiscalYearPeriodPrefix",
  "FiscalYearQuarterName",
  "FiscalYearQuarterPrefix",
  "IdeaCategory",
  "IdeaMultiCategory",
  "IdeaStatus",
  "IdeaThemeStatus",
  "Industry",
  "InvoiceStatus",
  "LeadSource",
  "LeadStatus",
  "OpportunityCompetitor",
  "OpportunityStage",
  "OpportunityType",
  "OrderStatus",
  "OrderType",
  "PartnerRole",
  "Product2Family",
  "QuestionOrigin",
  "QuickTextCategory",
  "QuickTextChannel",
  "QuoteStatus",
  "SalesTeamRole",
  "Salutation",
  "ServiceContractApprovalStatus",
  "SocialPostClassification",
  "SocialPostEngagementLevel",
  "SocialPostReviewedStatus",
  "SolutionStatus",
  "TaskPriority",
  "TaskStatus",
  "TaskSubject",
  "TaskType",
  "WorkOrderLineItemStatus",
  "WorkOrderPriority",
  "WorkOrderStatus"
];
/**
 * This code was adapted from github:sfdx-jayree-plugin project which was
 * based on the original github:sfdx-hydrate project
 */
export class Packagexml {
  public configs: BuildConfig;
  private conn: Connection;
  private packageTypes = {};
  private ipRegex: RegExp;
  private ipPromise;

  public result: {
    type: string;
    createdById?: string;
    createdByName?: string;
    createdDate?: string;
    fileName?: string;
    fullName: string;
    id?: string;
    lastModifiedById?: string;
    lastModifiedByName?: string;
    lastModifiedDate?: string;
    manageableState?: string;
    namespacePrefix?: string;
  }[];

  constructor(conn: Connection, configs: BuildConfig) {
    this.conn = conn;
    this.configs = configs;
    this.result = [];
  }

  public async build() {
    try {
      const folders = [];
      const unfolderedObjects = [];

      await this.describeMetadata(unfolderedObjects, folders);

      await this.buildInstalledPackageRegex();

      await this.handleUnfolderedObjects(unfolderedObjects);

      await this.handleFolderedObjects(folders);

      if (!this.packageTypes["StandardValueSet"]) {
        this.packageTypes["StandardValueSet"] = [];
      }
      STANDARD_VALUE_SETS.forEach(member => {
        this.packageTypes["StandardValueSet"].push(member);
        this.result.push({
          type: "StandardValueSet",
          fullName: member
        });
      });

      let packageXml = this.generateXml();

      let dir = path.parse(this.configs.outputFile).dir;
      if (!fs.existsSync(dir)) {
        FileUtils.mkDirByPathSync(dir);
      }
      fs.writeFileSync(this.configs.outputFile, packageXml);
      return packageXml;
    } catch (err) {
      console.log(err);
    }
  }

  private async buildInstalledPackageRegex() {
    // fetch and execute installed package promise to build regex
    let ipRegexStr: string = "^(";
    if (this.ipPromise) {
      this.ipPromise.then(instPack => {
        instPack.forEach(pkg => {
          ipRegexStr += pkg.namespacePrefix + "|";
        });
        ipRegexStr += ")+__";
        this.ipRegex = RegExp(ipRegexStr);
      });
    } else {
      this.ipRegex = RegExp("");
    }
  }

  private async describeMetadata(
    unfolderedObjects: Promise<FileProperties[]>[],
    folders: Promise<FileProperties[]>[]
  ) {
    const describe = await this.conn.metadata.describe(this.configs.apiVersion);

    for await (const object of describe.metadataObjects) {
      if (
        this.configs.quickFilters.length !== 0 &&
        !this.configs.quickFilters.includes(object.xmlName)
      ) {
        continue;
      }

      if (object.inFolder) {
        const objectType = object.xmlName.replace("Template", "");
        const promise = this.conn.metadata.list(
          {
            type: `${objectType}Folder`
          },
          this.configs.apiVersion
        );
        folders.push(promise);
      } else {
        const promise = this.conn.metadata.list(
          {
            type: object.xmlName
          },
          this.configs.apiVersion
        );
        if (object.xmlName === "InstalledPackage") {
          this.ipPromise = promise.then(); // clone promise
        }
        unfolderedObjects.push(promise);
      }
    }
  }

  private generateXml() {
    const packageJson = {
      $: { xmlns: "http://soap.sforce.com/2006/04/metadata" },
      types: [],
      version: this.configs.apiVersion
    };

    Object.keys(this.packageTypes).forEach(mdtype => {
      if (
        this.configs.quickFilters.length === 0 ||
        this.configs.quickFilters.includes(mdtype)
      ) {
        packageJson.types.push({
          name: mdtype,
          members: this.packageTypes[mdtype].sort()
        });
      }
    });

    const builder = new xml2js.Builder({
      xmldec: { version: "1.0", encoding: "utf-8" }
    });
    let packageObj = {
      Package: packageJson
    };
    let packageXml = builder.buildObject(packageObj);
    return packageXml;
  }

  private async handleFolderedObjects(folders: Promise<FileProperties[]>[]) {
    const folderedObjects: Promise<FileProperties[]>[] = [];
    for await (const folder of folders) {
      let folderItems = [];
      if (Array.isArray(folder)) {
        folderItems = folder;
      } else if (folder) {
        folderItems = [folder];
      }
      if (folderItems.length > 0) {
        for await (const folderItem of folderItems) {
          if (folderItem) {
            this.result.push(folderItem);
            let objectType = folderItem.type.replace("Folder", "");
            if (objectType === "Email") {
              objectType += "Template";
            }

            this.addMember(objectType, folderItem);

            const promise = this.conn.metadata.list(
              {
                type: objectType,
                folder: folderItem.fullName
              },
              this.configs.apiVersion
            );
            folderedObjects.push(promise);
          }
        }
      }
    }

    (await Promise.all(folderedObjects)).forEach(folderedObject => {
      try {
        if (folderedObject) {
          let folderedObjectItems = [];
          if (Array.isArray(folderedObject)) {
            folderedObjectItems = folderedObject;
          } else {
            folderedObjectItems = [folderedObject];
          }
          folderedObjectItems.forEach(metadataEntries => {
            if (metadataEntries) {
              this.addMember(metadataEntries.type, metadataEntries);
              this.result.push(metadataEntries);
            } else {
              console.log("No metadataEntry available");
            }
          });
        }
      } catch (err) {
        console.log(err);
      }
    });
  }

  private async handleUnfolderedObjects(
    unfolderedObjects: Promise<FileProperties[]>[]
  ) {
    (await Promise.all(unfolderedObjects)).forEach(unfolderedObject => {
      try {
        if (unfolderedObject) {
          let unfolderedObjectItems = [];
          if (Array.isArray(unfolderedObject)) {
            unfolderedObjectItems = unfolderedObject;
          } else {
            unfolderedObjectItems = [unfolderedObject];
          }
          unfolderedObjectItems.forEach(metadataEntries => {
            if (metadataEntries) {
              this.addMember(metadataEntries.type, metadataEntries);
              this.result.push(metadataEntries);
            } else {
              console.log("No metadataEntry available");
            }
          });
        }
      } catch (err) {
        console.log(err);
      }
    });
  }

  private addMember(type: string, member: FileProperties) {
    /**
     * Managed package - fullName starts with 'namespacePrefix__' || namespacePrefix is not null || manageableState = installed
     * Unmanaged package - manageableState = unmanaged
     * Regular custom objects - manageableState = unmanaged or undefined
     */

    if (
      type &&
      !(typeof type === "object") &&
      !(
        this.configs.excludeManaged &&
        (this.ipRegex.test(member.fullName) ||
          member.namespacePrefix ||
          member.manageableState === "installed")
      )
    ) {
      try {
        if (member.fileName.includes("ValueSetTranslation")) {
          const x =
            member.fileName
              .split(".")[1]
              .substring(0, 1)
              .toUpperCase() + member.fileName.split(".")[1].substring(1);
          if (!this.packageTypes[x]) {
            this.packageTypes[x] = [];
          }
          this.packageTypes[x].push(member.fullName);
        } else {
          if (!this.packageTypes[type]) {
            this.packageTypes[type] = [];
          }
          this.packageTypes[type].push(member.fullName);
        }
      } catch (ex) {
        console.log("Type " + JSON.stringify(type));
      }
    }
  }
}

export class BuildConfig {
  public quickFilters: string[];
  public excludeManaged: boolean;
  public apiVersion: string;
  public targetDir: string;
  public outputFile: string;

  constructor(flags: object, apiVersion: string) {
    // flags always take precendence over configs from file
    this.excludeManaged = flags["excludemanaged"];
    this.apiVersion = flags["apiversion"] || apiVersion;
    this.quickFilters = flags["quickfilter"]
      ? flags["quickfilter"].split(",").map(elem => {
          return elem.trim();
        })
      : [];
    this.outputFile = flags["outputfile"] || "package.xml";
  }
}
