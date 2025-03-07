/*
 * Copyright (c) 2022 Samsung Electronics Co., Ltd. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {obtainWorkspaceRoots} from '../Utils/Helpers';
import {Logger} from '../Utils/Logger';

import {ConfigObj} from './ConfigObject';

interface StringListMap {
  [key: string]: string[];
}

interface ConfigObjMap {
  [key: string]: ConfigObj|null;
}

/**
 * A singleton storage class
 *
 * PURPOSE
 *
 * To build each 'Node' of OneTreeDataProvider,
 * it is neccessary to access the file system, read the files and build objects(ConfigObj, ...).
 * By keeping some file system information as data structure (list, map),
 * some duplicated works can be reduced.
 *
 * LIFE CYCLE
 *
 * The singleton is created when the first get() is called.
 * The object remains until OneStorage.reset() is called.
 * OneStorage.reset() is called by OneTreeDataProvider.refresh(), which is called on every file
 * system change within the repository.
 */
export class OneStorage {
  /**
   * A map of ConfigObj (key: cfg path)
   */
  private _cfgToCfgObjMap: ConfigObjMap;
  /**
   * A map of BaseModel path to Cfg path
   */
  private _baseModelToCfgsMap: StringListMap;

  /**
   * Get the list of .cfg files within the workspace
   * @param root  the file or directory,
   *              which MUST exist in the file system
   */
  private _initCfgList(roots: string[] = obtainWorkspaceRoots()): string[] {
    /**
     * Returns an array of all the file names inside the root directory
     * @todo Check soft link
     */
    const readdirSyncRecursive = (root: string): string[] => {
      if (fs.statSync(root).isFile()) {
        return [root];
      }

      let children: string[] = [];
      if (fs.statSync(root).isDirectory()) {
        fs.readdirSync(root).forEach(val => {
          children = children.concat(readdirSyncRecursive(path.join(root, val)));
        });
      }
      return children;
    };

    try {
      return roots.map(root => readdirSyncRecursive(root).filter(val => val.endsWith('.cfg')))
          .reduce((prev, cur) => [...prev, ...cur]);
    } catch {
      Logger.error('OneExplorer', '_initCfgList', 'called on not existing directory or file.');
      return [];
    }
  }

  private _initCfgToCfgObjMap(cfgList: string[]): ConfigObjMap {
    let map: ConfigObjMap = {};

    cfgList.forEach(cfg => {
      map[cfg] = ConfigObj.createConfigObj(vscode.Uri.file(cfg));
    });

    return map;
  }

  private _initBaseModelToCfgsMap(cfgList: string[], cfgToCfgObjMap: ConfigObjMap): StringListMap {
    let map: StringListMap = {};

    cfgList.forEach(cfg => {
      const cfgObj = cfgToCfgObjMap[cfg];
      if (cfgObj) {
        cfgObj.getBaseModelsExists.forEach(baseModelArtifact => {
          if (!map[baseModelArtifact.path]) {
            map[baseModelArtifact.path] = [];
          }

          if (!map[baseModelArtifact.path].includes(cfg)) {
            map[baseModelArtifact.path].push(cfg);
          }
        });
      }
    });

    return map;
  }

  private constructor() {
    const cfgList = this._initCfgList();
    this._cfgToCfgObjMap = this._initCfgToCfgObjMap(cfgList);
    this._baseModelToCfgsMap = this._initBaseModelToCfgsMap(cfgList, this._cfgToCfgObjMap);
  }

  private static _obj: OneStorage|undefined;

  /**
   * Get cfg lists which refers the base model path
   * @param baseModelPath
   * @return a list of cfg path or undefined
   *         'undefined' is returned when
   *          (1) the path not exists
   *          (2) the path is not a base model file
   *          (3) the path is a lonely base model file
   */
  public static getCfgs(baseModelPath: string): string[]|undefined {
    return OneStorage.get()._baseModelToCfgsMap[baseModelPath];
  }

  /**
   * Get cfgObj from the map
   */
  public static getCfgObj(cfgPath: string): ConfigObj|null {
    return OneStorage.get()._cfgToCfgObjMap[cfgPath];
  }

  /**
   * Get a singleton object
   */
  private static get(): OneStorage {
    if (!OneStorage._obj) {
      OneStorage._obj = new OneStorage;
    }
    return OneStorage._obj;
  }

  public static reset(): void {
    OneStorage._obj = undefined;
  }

  public static resetBaseModel(path: string): void {
    delete OneStorage.get()._baseModelToCfgsMap[path];
    Logger.debug('OneStorage', `Base Mode Path(${path}) is removed.`);
  }

  public static resetConfig(path: string): void {
    delete OneStorage.get()._cfgToCfgObjMap[path];
    Object.entries(OneStorage.get()._baseModelToCfgsMap).forEach(([modelpath]) => {
      OneStorage.get()._baseModelToCfgsMap[modelpath] =
          OneStorage.get()._baseModelToCfgsMap[modelpath].filter(cfg => cfg !== path);
    });
    Logger.debug('OneStorage', `Config Path(${path}) is removed.`);
  }
}
