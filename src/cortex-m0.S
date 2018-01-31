.section .stack_ptr
.global _vectors
_vectors:
/* startup */
.word _stack_top

.section .text
.global _Z21interruptHandlerResetv
_Z21interruptHandlerResetv:

/* copy data */
ldr r4, =_data_src
ldr r5, =_data_start
ldr r6, =_data_end
.Lcopy_data_loop:
cmp r5, r6
beq .Lcopy_data_break
ldr r7, [r4]
str r7, [r5]
add r4, #4
add r5, #4
b .Lcopy_data_loop
.Lcopy_data_break:

/* init bss */
ldr r4, =_bss_start
ldr r5, =_bss_end
ldr r6, =0
.Linit_bss_loop:
cmp r4, r5
beq .Linit_bss_break
str r6, [r4]
add r4, #4
b .Linit_bss_loop
.Linit_bss_break:

/* constructors */
ldr r4, =_init_array_start
ldr r5, =_init_array_end
.Lconstructors_loop:
cmp r4, r5
beq .Lconstructors_break
ldr r6, [r4]
blx r6
add r4, #4
b .Lconstructors_loop
.Lconstructors_break:

bl _Z15initApplicationv
/* aplication loop */
.Laplication_loop:
WFI
bl _Z11handleEventv
b .Laplication_loop

.global __cxa_pure_virtual
__cxa_pure_virtual:
b fatalError


