-- El stock representa el saldo físico real. Una entrega sin existencias
-- registradas debe dejar un faltante visible en lugar de ocultar la salida.
alter table inventory drop constraint if exists inventory_quantity_check;
