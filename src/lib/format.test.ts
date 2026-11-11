import { describe, expect, it } from 'vitest';
import { money, moneyCompact, percent } from './format';

describe('money', () => {
    it('usa separador de miles argentino y redondea a pesos enteros', () => {
        expect(money(1091936.5)).toBe('$1.091.937');
        expect(money(9876.5)).toBe('$9.877');
        expect(money(40000)).toBe('$40.000');
        expect(money(0)).toBe('$0');
    });

    it('pone el signo antes del $', () => {
        expect(money(-15000)).toBe('-$15.000');
        expect(money(-0.4)).toBe('$0');
    });

    it('sin valor muestra $0 (antes quedaba un "$" suelto)', () => {
        expect(money(undefined)).toBe('$0');
        expect(money(null)).toBe('$0');
        expect(money(NaN)).toBe('$0');
    });
});

describe('moneyCompact', () => {
    it('abrevia miles y millones', () => {
        expect(moneyCompact(850)).toBe('$850');
        expect(moneyCompact(47500)).toBe('$48k');
        expect(moneyCompact(1890000)).toBe('$1,9M');
        expect(moneyCompact(1000784)).toBe('$1M');
        expect(moneyCompact(-250000)).toBe('-$250k');
    });
});

describe('percent', () => {
    it('un decimal con coma', () => {
        expect(percent(42.176)).toBe('42,2%');
        expect(percent(19)).toBe('19,0%');
        expect(percent(-3.25)).toBe('-3,3%');
        expect(percent(NaN)).toBe('0,0%');
    });
});
