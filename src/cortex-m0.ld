ENTRY(_vectors)

SECTIONS
{
   .text ROM_START : {
	   *(.stack_ptr*) 
	   *(.interrupts*) 
	   *(.text*)
   } 

   .rodata : { 
		. = ALIGN(4);
		*(.rodata*)
		. = ALIGN(4);

		_init_array_start = .;
		. = ALIGN(4);
		KEEP (*(SORT(.init_array.*)))
		KEEP (*(.init_array))
		. = ALIGN(4);
		_init_array_end = .; 

		_data_src = . ;
   } 

   .data RAM_START : AT ( _data_src ) { 
		_data_start = . ; 
		*(.data*) 
		. = ALIGN(4);
		_data_end = . ;

		_stack_top = RAM_SIZE ;
   } 

   .bss _data_end : AT ( . ) { 
		. = ALIGN(4);
	   _bss_start = . ;
	   *(.bss*)
	   *(COMMON*)
		. = ALIGN(4);
	   _bss_end = . ;
   } 

}
