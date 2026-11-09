import { modelo } from './utils/proposta.js';
// A configuração usada no app e no servidor tem origem em public/model.js.
export const config = {
  empresa: modelo.company(),
  servicos: modelo.services,
  condicoes: modelo.terms(),
  cores: { primaria: '#161c49', fundo: '#0b0e25', acento: '#32b9b5', papel: '#f7faf6', texto: '#10231c' }
};
