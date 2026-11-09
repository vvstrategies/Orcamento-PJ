import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {modelo} from '../utils/proposta.js';
import {defaultFinancialSettings,validateFinancialSettings} from './finance-domain.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const logoPath=path.join(root,'public','assets','pj-logo.jpg');

function logo(){
  return 'data:image/jpeg;base64,'+fs.readFileSync(logoPath).toString('base64');
}

// A configuração abaixo é somente o ponto de partida da instalação PJ.
// A senha do administrador continua obrigatória e nunca é distribuída com o projeto.
export function seedPJInstallation(repo){
  if(repo.config('pj-installation-v1')||repo.config('settings'))return;
  if(!fs.existsSync(logoPath))throw Error('O logotipo inicial da PJ não foi encontrado.');
  const company=modelo.normalizeCompany({
    name:'PJ Higienização',
    phone:'(11) 99402-4408',
    email:'pjhigienizacaosp@gmail.com',
    location:'Rua Manaus, 139, Rochdalle, Osasco - SP, 06226-030, Brasil',
    website:'',
    tagline:'Limpeza e Impermeabilização de Estofados',
    intro:'A PJ Higienização apresenta uma proposta de limpeza e impermeabilização preparada para o seu atendimento.',
    benefits:'Atendimento residencial e corporativo\nLimpeza e impermeabilização de estofados\nAtendimento em Osasco e região',
    logo:logo(),
    logoBackground:'light',
    useInitials:false,
    primaryColor:'#161c49',
    accentColor:'#32b9b5',
    proposalTitle:'Proposta de Higienização',
    proposalSubtitle:'Limpeza e Impermeabilização de Estofados',
    proposalPrefix:'PJ'
  });
  repo.transaction(()=>{
    repo.setConfig('settings',{company,terms:modelo.terms(),services:globalThis.UniversalCompany.defaultServices()});
    if(!repo.config('financial-settings-v1'))repo.setConfig('financial-settings-v1',validateFinancialSettings({
      ...defaultFinancialSettings(),defaultMaterialBps:1000,originMode:'company',roundTrip:true,
      vehicle:{id:'default',name:'Palio 2011',fuelType:'gasoline',consumptionCentiKmL:1200,fuelPriceCents:500,additionalCostPerKmCents:0}
    }));
    repo.setConfig('pj-installation-v1',true);
  });
}
