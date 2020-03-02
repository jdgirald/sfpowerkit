import { Org } from "@salesforce/core";
import * as _ from "lodash";
import BaseMetadataRetriever from "./baseMetadataRetriever";
import { Field } from "../schema";
import EntityDefinitionRetriever from "./entityDefinitionRetriever";
import { METADATA_INFO } from "../metadataInfo";
import MetadataFiles from "../metadataFiles";
import { isNullOrUndefined } from "util";

const QUERY =
  "SELECT Id, QualifiedApiName, EntityDefinitionId, DeveloperName, NamespacePrefix FROM FieldDefinition";
export default class FieldRetriever extends BaseMetadataRetriever<Field> {
  private static instance: FieldRetriever;
  private constructor(public org: Org) {
    super(org, true);
    super.setQuery(QUERY);
  }
  public static getInstance(org: Org): FieldRetriever {
    if (!FieldRetriever.instance) {
      FieldRetriever.instance = new FieldRetriever(org);
    }
    return FieldRetriever.instance;
  }
  public async getObjects(): Promise<Field[]> {
    let fieldsToReturn: Field[] = [];

    if (!this.data && !this.dataLoaded) {
      let entityDefinitionUtils = EntityDefinitionRetriever.getInstance(
        this.org
      );

      let objects = await entityDefinitionUtils.getObjectForPermission();
      this.data = {};

      for (let i = 0; i < objects.length; i++) {
        let objectName = objects[i];

        let durableId = await entityDefinitionUtils.getDurableIdByObjectName(
          objectName
        );
        if (!isNullOrUndefined(durableId) && durableId.length > 0) {
          super.setQuery(
            QUERY + " WHERE EntityDefinitionId ='" + durableId + "'"
          );
          let fields = await super.getObjects();
          fields = fields.map(field => {
            field.SobjectType = objectName;
            field.FullName = objectName + "." + field.QualifiedApiName;
            return field;
          });
          this.data[objectName] = fields;
          fieldsToReturn.push(...fields);
        }
      }
      this.dataLoaded = true;
    } else {
      if (this.data) {
        Object.keys(this.data).forEach(key => {
          fieldsToReturn.push(...this.data[key]);
        });
      }
    }
    return fieldsToReturn;
  }
  public async getFields(): Promise<Field[]> {
    return await this.getObjects();
  }
  public async getFieldsByObjectName(objectName: string): Promise<Field[]> {
    if (!this.data) {
      await this.getObjects();
    }
    if (!this.data[objectName]) {
      let entityDefinitionUtils = EntityDefinitionRetriever.getInstance(
        this.org
      );
      let fields = [];
      let durableId = await entityDefinitionUtils.getDurableIdByObjectName(
        objectName
      );

      if (!isNullOrUndefined(durableId) && durableId.length > 0) {
        super.setQuery(
          QUERY + " WHERE EntityDefinitionId ='" + durableId + "'"
        );
        fields = await super.getObjects();
        fields = fields.map(field => {
          field.SobjectType = objectName;
          field.FullName = objectName + "." + field.QualifiedApiName;
          return field;
        });
      }
      this.data[objectName] = fields;
    }
    return this.data[objectName];
  }

  public async fieldExist(fullName: string): Promise<boolean> {
    let found = false;
    let fieldParts = fullName.split(".");
    if (fieldParts.length !== 2) {
      return false;
    }
    //Look first in project files
    if (!_.isNil(METADATA_INFO.CustomField.components)) {
      found = METADATA_INFO.CustomField.components.includes(fullName);
    }
    if (!found && !MetadataFiles.sourceOnly) {
      //not found, check on the org
      let objectName = fieldParts[0];
      let fieldDefinitions = await this.getFieldsByObjectName(objectName);
      let field = fieldDefinitions.find(field => field.FullName === fullName);
      found = field !== undefined;
    }
    return found;
  }
}
