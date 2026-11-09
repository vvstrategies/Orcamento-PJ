import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Repository} from '../backend/database.js';
import {seedPJInstallation} from '../backend/pj-installation.js';
import {initializeInstallation} from '../backend/onboarding.js';
import {modelo} from '../utils/proposta.js';
import {snapshotAssumptions,defaultEstimateInput,calculateEstimate} from '../backend/finance-domain.js';

fs.mkdirSync('.tools',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('.tools/pj-installation-')),repo=new Repository(dir);
try{
 seedPJInstallation(repo);initializeInstallation(repo);
 const settings=repo.config('settings'),financial=repo.config('financial-settings-v1');
 assert.equal(settings.company.name,'PJ Higienização');
 assert.equal(settings.company.proposalPrefix,'PJ');
 assert.equal(settings.company.location,'Rua Manaus, 139, Rochdalle, Osasco - SP, 06226-030, Brasil');
 assert.match(settings.company.logo,/^data:image\/jpeg;base64,/);
 assert.equal(repo.config('adminPassword'),null);
 assert.equal(repo.list().length,0);
 assert.equal(repo.config('companySetup'),null);
 assert.equal(financial.defaultMaterialBps,1000);
 assert.equal(financial.vehicle.name,'Palio 2011');
 assert.equal(financial.vehicle.consumptionCentiKmL,1200);
 assert.equal(financial.vehicle.fuelPriceCents,500);
 const q=modelo.quote(settings);q.client='Validação fictícia';q.address='Endereço fictício';q.items=[{...modelo.item('Sofá'),price:200}];
 const result=calculateEstimate(q,snapshotAssumptions(financial,settings.company),{...defaultEstimateInput(),manualDistanceMeters:12000});
 assert.equal(result.materialCost,2000);assert.equal(result.fuelCost,1000);
 assert.equal(result.totalDistanceMeters,24000);assert.equal(result.totalDirectCost,3000);assert.equal(result.complete,true);
 repo.setConfig('financial-settings-v1',{...financial,defaultMaterialBps:1500});
 repo.setConfig('settings',{...settings,company:{...settings.company,name:'PJ editada'}});
 seedPJInstallation(repo);
 assert.equal(repo.config('financial-settings-v1').defaultMaterialBps,1500);
 assert.equal(repo.config('settings').company.name,'PJ editada');
 console.log('PASS: instalação PJ vazia, identidade, origem Osasco, custo 10%, 12 km/l, R$ 5/l e preferências preservadas no reinício.');
}finally{repo.close();}
